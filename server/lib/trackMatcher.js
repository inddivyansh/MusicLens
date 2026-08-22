/**
 * server/lib/trackMatcher.js
 * Production-quality entity-resolution pipeline for Spotify → MusicLens catalog matching.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * MATCHING PIPELINE  (4 stages, in priority order)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Stage 1 — Exact Spotify / catalog track ID
 *   Input:  spotify_track_id (Spotify Base62)
 *   Query:  single batched SELECT WHERE track_id = ANY(ids)
 *   Output: match_status = 'matched', confidence = 1.00, method = 'exact_id'
 *
 * Stage 2 — Normalized exact name + primary artist
 *   Input:  normalize(track_name) + normalize(artist_name)
 *   Query:  single batched SELECT on pre-normalized columns (or inline LOWER/REGEXP)
 *   Output: match_status = 'matched', confidence = 0.95, method = 'normalized_exact'
 *   Note:   If multiple catalog rows share the same normalized name+artist (e.g.
 *           album vs. single), ambiguity signals are checked before accepting.
 *
 * Stage 3 — Variant normalization (same query pass as stage 2, wider net)
 *   Strips common title suffixes before matching:
 *     feat/featuring, (with ...), remix, live, remastered, radio edit, deluxe,
 *     extended mix, acoustic, version, explicit, album version, mono, stereo,
 *     plus Unicode normalization (NFD → NFC), punctuation collapse, whitespace.
 *   Output: match_status = 'matched', confidence = 0.85, method = 'variant_normalized'
 *   Ambiguity: if >1 catalog candidates remain after variant stripping → 'ambiguous'
 *
 * Stage 4 — Fuzzy matching (Dice coefficient on trigrams, applied in-memory)
 *   Applied ONLY to tracks that reached this stage (not matched by 1-3).
 *   Candidates are sourced from a pre-loaded artist-scoped set (batch query).
 *   Threshold: FUZZY_ACCEPT_THRESHOLD = 0.82 — no match below this.
 *   Above threshold but multiple candidates: 'ambiguous' with tiebreaking signals.
 *   Output: match_status = 'matched'|'ambiguous', confidence ∈ [0.82, 1.0),
 *           method = 'fuzzy_trigram'
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AMBIGUITY RESOLUTION
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * When stage 2, 3, or 4 produces multiple catalog candidates, tiebreaking
 * signals are applied in order until a single winner is identified:
 *   1. album_name exact match (Spotify metadata vs. catalog)
 *   2. duration_ms proximity (closest within DURATION_TOLERANCE_MS = 3000)
 *   3. highest catalog track_popularity
 *   4. earliest standard_release_date (closest to Spotify track's album year, if known)
 *
 * If no signal resolves to a single winner, the result is kept as 'ambiguous'
 * with all_candidates populated. Ambiguous tracks are included in coverage
 * percentages but flagged as unreliable for strict evaluation.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DB EFFICIENCY
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * - Stage 1: one batched SELECT ANY() for all input IDs.
 * - Stage 2+3: one batched SELECT ANY() on normalized names+artists (VALUES join).
 * - Stage 4: one batched SELECT ANY() scoped to unresolved artists.
 * - persistUserTracks: one bulk INSERT ... SELECT unnest(ARRAY[...]) upsert.
 * - Zero N+1 patterns — no per-track queries anywhere.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * COVERAGE METRICS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Returned stats distinguish:
 *   exact_id_matches, normalized_matches, variant_matches, fuzzy_matches,
 *   ambiguous, unmatched, total, coverage_pct
 *
 * coverage_pct = (exact + normalized + variant + fuzzy + ambiguous) / total × 100
 * reliable_pct = (exact + normalized + variant + fuzzy) / total × 100
 * (ambiguous excluded from "reliable" — do not conflate them)
 */

'use strict';

const { getDb } = require('./db');

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Minimum Dice coefficient (trigram) to accept a fuzzy match at all. */
const FUZZY_ACCEPT_THRESHOLD = 0.82;

/** Maximum absolute duration difference (ms) for duration-based tiebreaking. */
const DURATION_TOLERANCE_MS = 3000;

// ─────────────────────────────────────────────────────────────────────────────
// Text normalization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Base normalization: lower-case, Unicode NFC, collapse punctuation + whitespace.
 * Used at every stage.
 */
function normalize(str) {
  if (!str) return '';
  return str
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\w\s]/gu, ' ')  // collapse all non-word chars to space
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Variant normalization: apply base normalize then strip common title decorators.
 * Used at stage 3 to widen the matching net.
 *
 * Strips (in order, case-insensitive on the already-lowercased string):
 *   - parenthesized / bracketed suffixes:  (feat. …)  [live]  (remastered 2011)
 *   - known keyword suffixes at word boundary:
 *       feat / featuring / with / remix / live / remastered / radio edit /
 *       deluxe / extended mix / acoustic version / album version / explicit /
 *       mono / stereo / original mix / single version / bonus track
 */
function normalizeVariant(str) {
  if (!str) return '';
  let s = normalize(str);

  // 1. Strip parenthesized / bracketed content at end of title
  s = s.replace(/[\(\[][^\)\]]*[\)\]]\s*$/g, '').trim();

  // 2. Strip common suffix keywords (after a separator character or space)
  const suffixPatterns = [
    /\s*[-–—|]\s*(feat|ft|featuring|with)\b.*/,
    /\s+(feat|ft|featuring|with)\b.*/,
    /\s+(remix|remixed|rework|edit)\b.*/,
    /\s+(live|live version|live at\b).*/,
    /\s+(remaster(ed)?|remaster\d{0,4})\b.*/,
    /\s+(radio edit|radio version)\b.*/,
    /\s+(deluxe|deluxe edition|deluxe version)\b.*/,
    /\s+(extended|extended mix|extended version)\b.*/,
    /\s+(acoustic|acoustic version)\b.*/,
    /\s+(album version|single version|original version|original mix)\b.*/,
    /\s+(explicit|clean version|clean)\b.*/,
    /\s+(bonus track|bonus)\b.*/,
    /\s+(mono|stereo)\b.*/,
  ];

  for (const pat of suffixPatterns) {
    s = s.replace(pat, '').trim();
  }

  return s;
}

/**
 * Artist normalization: strip "The ", "A " prefixes, common suffixes.
 * Used for artist-level matching where these prefixes cause misses.
 */
function normalizeArtist(str) {
  if (!str) return '';
  return normalize(str)
    .replace(/^the\s+/, '')
    .replace(/^a\s+/, '')
    .trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Trigram fuzzy matching (Dice coefficient — no external deps)
// ─────────────────────────────────────────────────────────────────────────────

function trigrams(str) {
  const s = ` ${str} `;
  const set = new Set();
  for (let i = 0; i < s.length - 2; i++) {
    set.add(s.slice(i, i + 3));
  }
  return set;
}

function diceCoefficient(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  for (const t of ta) {
    if (tb.has(t)) intersection++;
  }
  return (2 * intersection) / (ta.size + tb.size);
}

// ─────────────────────────────────────────────────────────────────────────────
// Ambiguity tiebreaking
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Given multiple catalog candidate rows and the original Spotify track metadata,
 * attempt to resolve to a single best match using auxiliary signals.
 *
 * Returns { winner: row|null, resolved: bool }
 *   winner  — best candidate (or null if still ambiguous)
 *   resolved — true if tiebreaking produced a single confident winner
 */
function tiebreak(candidates, spotifyMeta) {
  if (candidates.length === 0) return { winner: null, resolved: false };
  if (candidates.length === 1) return { winner: candidates[0], resolved: true };

  let pool = [...candidates];

  // Signal 1: exact album name match
  if (spotifyMeta.album_name) {
    const normAlbum = normalize(spotifyMeta.album_name);
    const albumMatches = pool.filter(
      (c) => c.track_album_name && normalize(c.track_album_name) === normAlbum
    );
    if (albumMatches.length === 1) return { winner: albumMatches[0], resolved: true };
    if (albumMatches.length > 1) pool = albumMatches;
  }

  // Signal 2: duration proximity
  if (spotifyMeta.duration_ms != null) {
    const dur = Number(spotifyMeta.duration_ms);
    const durMatches = pool.filter(
      (c) =>
        c.duration_ms != null &&
        Math.abs(Number(c.duration_ms) - dur) <= DURATION_TOLERANCE_MS
    );
    if (durMatches.length === 1) return { winner: durMatches[0], resolved: true };
    if (durMatches.length > 1) pool = durMatches;
  }

  // Signal 3: highest catalog popularity
  const maxPop = Math.max(...pool.map((c) => Number(c.track_popularity ?? 0)));
  const popMatches = pool.filter((c) => Number(c.track_popularity ?? 0) === maxPop);
  if (popMatches.length === 1) return { winner: popMatches[0], resolved: true };
  pool = popMatches;

  // Signal 4: earliest release date (pick the original, not a remaster)
  const withDates = pool
    .filter((c) => c.standard_release_date)
    .sort((a, b) => {
      const ya = parseInt(String(a.standard_release_date).slice(0, 4), 10) || 9999;
      const yb = parseInt(String(b.standard_release_date).slice(0, 4), 10) || 9999;
      return ya - yb;
    });
  if (withDates.length === 1) return { winner: withDates[0], resolved: true };
  if (withDates.length > 1) return { winner: withDates[0], resolved: false }; // best guess, still ambiguous

  return { winner: pool[0], resolved: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// DB catalog loading (batched)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load catalog rows needed for stage 2 / 3 / 4 matching from a single batched
 * query.  Returns a map of track_id → catalog row with the columns needed for
 * matching and tiebreaking.
 */
async function batchLoadCatalogByIds(sql, trackIds) {
  if (!trackIds || trackIds.length === 0) return new Map();
  const rows = await sql`
    SELECT
      t.track_id,
      t.track_name,
      t.track_artist,
      t.track_album_name,
      t.track_album_id,
      t.track_popularity,
      t.standard_release_date,
      t.duration_ms
    FROM tracks t
    WHERE t.track_id = ANY(${trackIds})
  `;
  const map = new Map();
  for (const r of rows) map.set(r.track_id, r);
  return map;
}

/**
 * Load catalog rows for name+artist matching.
 * Uses a VALUES-list join to avoid N+1 queries.
 *
 * Returns a map of  `${normName}|||${normArtist}` → catalog row[].
 * Multiple rows per key are possible (same artist+title, different albums).
 */
async function batchLoadCatalogByNameArtist(sql, pairs) {
  // pairs: Array<{ normName: string, normArtist: string }>
  if (!pairs || pairs.length === 0) return new Map();

  // Deduplicate pairs
  const uniquePairs = [...new Map(pairs.map((p) => [`${p.normName}|||${p.normArtist}`, p])).values()];

  // We need to match normalized forms. The catalog stores raw text, so we
  // normalize inline in SQL.  Use a single query with OR'd equality rather
  // than N queries — PostgreSQL will use a hash join if both sides are small.
  const normNames = uniquePairs.map((p) => p.normName);
  const normArtists = uniquePairs.map((p) => p.normArtist);

  const rows = await sql`
    SELECT
      t.track_id,
      t.track_name,
      t.track_artist,
      t.track_album_name,
      t.track_album_id,
      t.track_popularity,
      t.standard_release_date,
      t.duration_ms,
      LOWER(REGEXP_REPLACE(LOWER(t.track_name),   '[^\\w\\s]', ' ', 'g')) AS norm_name,
      LOWER(REGEXP_REPLACE(LOWER(t.track_artist), '[^\\w\\s]', ' ', 'g')) AS norm_artist
    FROM tracks t
    WHERE
      LOWER(REGEXP_REPLACE(LOWER(t.track_name),   '[^\\w\\s]', ' ', 'g')) = ANY(${normNames})
      AND
      LOWER(REGEXP_REPLACE(LOWER(t.track_artist), '[^\\w\\s]', ' ', 'g')) = ANY(${normArtists})
  `;

  const map = new Map();
  for (const r of rows) {
    // Re-check both conditions — ANY() is an OR across names × artists,
    // so we might get rows that matched name but not artist. Filter precisely.
    const key = `${r.norm_name}|||${r.norm_artist}`;
    const existingList = map.get(key);
    if (existingList) {
      existingList.push(r);
    } else {
      map.set(key, [r]);
    }
  }
  return map;
}

/**
 * Load all catalog tracks for a set of artist names (stage 4 fuzzy candidates).
 * Returns map of normArtist → catalog row[].
 */
async function batchLoadCatalogByArtists(sql, normArtists) {
  if (!normArtists || normArtists.length === 0) return new Map();
  const rows = await sql`
    SELECT
      t.track_id,
      t.track_name,
      t.track_artist,
      t.track_album_name,
      t.track_album_id,
      t.track_popularity,
      t.standard_release_date,
      t.duration_ms,
      LOWER(REGEXP_REPLACE(LOWER(t.track_artist), '[^\\w\\s]', ' ', 'g')) AS norm_artist
    FROM tracks t
    WHERE
      LOWER(REGEXP_REPLACE(LOWER(t.track_artist), '[^\\w\\s]', ' ', 'g')) = ANY(${normArtists})
  `;
  const map = new Map();
  for (const r of rows) {
    const key = r.norm_artist;
    const list = map.get(key);
    if (list) list.push(r);
    else map.set(key, [r]);
  }
  return map;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Match a batch of Spotify tracks against the MusicLens catalog using the
 * 4-stage entity-resolution pipeline.  All database work is batched — no N+1.
 *
 * @param {Array<{
 *   spotify_track_id: string,
 *   track_name: string,
 *   artist_name: string,
 *   album_name?: string,
 *   duration_ms?: number,
 *   source: string,
 *   played_at?: string|null,
 *   added_at?: string|null,
 *   interaction_count?: number,
 *   popularity?: number,
 * }>} spotifyTracks
 *
 * @returns {Promise<{
 *   results: MatchResult[],
 *   stats: MatchStats
 * }>}
 *
 * @typedef {Object} MatchResult
 * @property {string}      spotify_track_id
 * @property {string|null} catalog_track_id
 * @property {'matched'|'ambiguous'|'unmatched'} match_status
 * @property {number}      confidence          — 0.0–1.0
 * @property {string}      matching_method     — exact_id|normalized_exact|variant_normalized|fuzzy_trigram|none
 * @property {string}      track_name
 * @property {string}      artist_name
 * @property {string}      source
 * @property {string|null} played_at
 * @property {string|null} added_at
 * @property {number}      interaction_count
 * @property {Array|null}  all_candidates      — populated when match_status='ambiguous'
 *
 * @typedef {Object} MatchStats
 * @property {number} total
 * @property {number} exact_id_matches
 * @property {number} normalized_matches
 * @property {number} variant_matches
 * @property {number} fuzzy_matches
 * @property {number} ambiguous
 * @property {number} unmatched
 * @property {number} coverage_pct   — (exact+norm+variant+fuzzy+ambiguous)/total
 * @property {number} reliable_pct   — (exact+norm+variant+fuzzy)/total
 */
async function matchTracks(spotifyTracks) {
  if (!spotifyTracks || spotifyTracks.length === 0) {
    return {
      results: [],
      stats: {
        total: 0, exact_id_matches: 0, normalized_matches: 0,
        variant_matches: 0, fuzzy_matches: 0,
        ambiguous: 0, unmatched: 0, coverage_pct: 0, reliable_pct: 0,
      },
    };
  }

  const sql = getDb();

  // ── Pre-process: normalize inputs once, build working set ───────────────

  const workingSet = spotifyTracks.map((t) => ({
    original: t,
    spotify_track_id: t.spotify_track_id || '',
    track_name: t.track_name || '',
    artist_name: t.artist_name || '',
    album_name: t.album_name || t.album_name || '',
    duration_ms: t.duration_ms ?? null,
    source: t.source || 'top_tracks',
    played_at: t.played_at ?? null,
    added_at: t.added_at ?? null,
    interaction_count: Number(t.interaction_count) || 1,
    // Normalized forms, computed once
    norm_name: normalize(t.track_name),
    norm_artist: normalize(t.artist_name),
    norm_artist_alt: normalizeArtist(t.artist_name),
    variant_name: normalizeVariant(t.track_name),
    variant_artist: normalizeArtist(t.artist_name),
    // Will be filled by pipeline stages
    result: null,
  }));

  const unresolved = (set) => set.filter((w) => w.result === null);

  // ── Stage 1: Exact Spotify / catalog track ID ────────────────────────────

  const allSpotifyIds = [...new Set(workingSet.map((w) => w.spotify_track_id).filter(Boolean))];
  let exactIdMap = new Map(); // spotify_track_id → catalog row

  if (allSpotifyIds.length > 0) {
    try {
      const rows = await sql`
        SELECT
          t.track_id,
          t.track_name,
          t.track_artist,
          t.track_album_name,
          t.track_album_id,
          t.track_popularity,
          t.standard_release_date,
          t.duration_ms
        FROM tracks t
        WHERE t.track_id = ANY(${allSpotifyIds})
      `;
      for (const r of rows) exactIdMap.set(r.track_id, r);
    } catch (err) {
      console.warn('[trackMatcher] Stage 1 batch query failed:', err.message);
    }
  }

  for (const w of workingSet) {
    if (exactIdMap.has(w.spotify_track_id)) {
      const cat = exactIdMap.get(w.spotify_track_id);
      w.result = _buildResult(w, cat, 'matched', 1.00, 'exact_id', null);
    }
  }

  // ── Stage 2: Normalized exact name + artist ──────────────────────────────

  const needsStage2 = unresolved(workingSet);
  let nameArtistMap = new Map();

  if (needsStage2.length > 0) {
    const pairs = needsStage2.map((w) => ({
      normName: w.norm_name,
      normArtist: w.norm_artist,
    }));
    // Also include the alt-normalized artist form
    const altPairs = needsStage2
      .filter((w) => w.norm_artist_alt !== w.norm_artist)
      .map((w) => ({ normName: w.norm_name, normArtist: w.norm_artist_alt }));

    try {
      nameArtistMap = await batchLoadCatalogByNameArtist(sql, [...pairs, ...altPairs]);
    } catch (err) {
      console.warn('[trackMatcher] Stage 2 batch query failed:', err.message);
    }

    for (const w of needsStage2) {
      const key1 = `${w.norm_name}|||${w.norm_artist}`;
      const key2 = `${w.norm_name}|||${w.norm_artist_alt}`;
      const candidates = [
        ...(nameArtistMap.get(key1) || []),
        ...(nameArtistMap.get(key2) || []),
      ];
      // Deduplicate candidates by track_id
      const deduped = _dedupeById(candidates);
      if (deduped.length === 0) continue;
      if (deduped.length === 1) {
        w.result = _buildResult(w, deduped[0], 'matched', 0.95, 'normalized_exact', null);
      } else {
        const { winner, resolved } = tiebreak(deduped, w);
        if (resolved && winner) {
          w.result = _buildResult(w, winner, 'matched', 0.95, 'normalized_exact', null);
        } else {
          w.result = _buildResult(w, winner, 'ambiguous', 0.90, 'normalized_exact', deduped);
        }
      }
    }
  }

  // ── Stage 3: Variant normalization ──────────────────────────────────────

  const needsStage3 = unresolved(workingSet);
  let variantMap = new Map();

  if (needsStage3.length > 0) {
    const variantPairs = needsStage3.map((w) => ({
      normName: w.variant_name,
      normArtist: w.variant_artist,
    }));
    const variantAltPairs = needsStage3
      .filter((w) => w.variant_artist !== w.norm_artist)
      .map((w) => ({ normName: w.variant_name, normArtist: w.norm_artist }));

    try {
      variantMap = await batchLoadCatalogByNameArtist(sql, [...variantPairs, ...variantAltPairs]);
    } catch (err) {
      console.warn('[trackMatcher] Stage 3 batch query failed:', err.message);
    }

    for (const w of needsStage3) {
      if (w.result !== null) continue; // stage 2 may have resolved some
      const key1 = `${w.variant_name}|||${w.variant_artist}`;
      const key2 = `${w.variant_name}|||${w.norm_artist}`;
      const candidates = _dedupeById([
        ...(variantMap.get(key1) || []),
        ...(variantMap.get(key2) || []),
      ]);
      if (candidates.length === 0) continue;
      if (candidates.length === 1) {
        w.result = _buildResult(w, candidates[0], 'matched', 0.85, 'variant_normalized', null);
      } else {
        const { winner, resolved } = tiebreak(candidates, w);
        if (resolved && winner) {
          w.result = _buildResult(w, winner, 'matched', 0.85, 'variant_normalized', null);
        } else {
          w.result = _buildResult(w, winner, 'ambiguous', 0.75, 'variant_normalized', candidates);
        }
      }
    }
  }

  // ── Stage 4: Fuzzy matching (Dice trigram, artist-scoped) ────────────────

  const needsStage4 = unresolved(workingSet);
  let artistCatalogMap = new Map();

  if (needsStage4.length > 0) {
    const artistsToSearch = [
      ...new Set([
        ...needsStage4.map((w) => w.norm_artist),
        ...needsStage4.map((w) => w.norm_artist_alt),
        ...needsStage4.map((w) => w.variant_artist),
      ].filter(Boolean)),
    ];

    try {
      artistCatalogMap = await batchLoadCatalogByArtists(sql, artistsToSearch);
    } catch (err) {
      console.warn('[trackMatcher] Stage 4 batch query failed:', err.message);
    }

    for (const w of needsStage4) {
      if (w.result !== null) continue;

      // Collect all catalog tracks for this artist (any of the 3 normalized forms)
      const candidateSet = new Map();
      for (const normArt of [w.norm_artist, w.norm_artist_alt, w.variant_artist]) {
        for (const row of (artistCatalogMap.get(normArt) || [])) {
          if (!candidateSet.has(row.track_id)) candidateSet.set(row.track_id, row);
        }
      }
      if (candidateSet.size === 0) continue;

      // Score each candidate by Dice coefficient on the track name
      const scored = [];
      for (const [, row] of candidateSet) {
        const catNorm = normalize(row.track_name);
        const catVariant = normalizeVariant(row.track_name);
        // Compare both the original and variant-normalized forms
        const score = Math.max(
          diceCoefficient(w.norm_name, catNorm),
          diceCoefficient(w.variant_name, catVariant),
          diceCoefficient(w.norm_name, catVariant),
        );
        if (score >= FUZZY_ACCEPT_THRESHOLD) {
          scored.push({ row, score });
        }
      }

      if (scored.length === 0) continue;

      // Sort by score descending
      scored.sort((a, b) => b.score - a.score);
      const bestScore = scored[0].score;
      // Accept candidates within 2 % of the best score as "tied"
      const tied = scored.filter((s) => s.score >= bestScore - 0.02).map((s) => s.row);

      if (tied.length === 1) {
        w.result = _buildResult(w, tied[0], 'matched', bestScore, 'fuzzy_trigram', null);
      } else {
        const { winner, resolved } = tiebreak(tied, w);
        const status = resolved ? 'matched' : 'ambiguous';
        w.result = _buildResult(w, winner, status, bestScore, 'fuzzy_trigram',
          status === 'ambiguous' ? tied : null);
      }
    }
  }

  // ── Finalize: mark remaining as unmatched ────────────────────────────────

  for (const w of workingSet) {
    if (w.result === null) {
      w.result = _buildResult(w, null, 'unmatched', 0, 'none', null);
    }
  }

  // ── Build stats ──────────────────────────────────────────────────────────

  const results = workingSet.map((w) => w.result);
  const total = results.length;

  const exactIdCount = results.filter((r) => r.matching_method === 'exact_id').length;
  const normalizedCount = results.filter((r) => r.matching_method === 'normalized_exact' && r.match_status === 'matched').length;
  const variantCount = results.filter((r) => r.matching_method === 'variant_normalized' && r.match_status === 'matched').length;
  const fuzzyCount = results.filter((r) => r.matching_method === 'fuzzy_trigram' && r.match_status === 'matched').length;
  const ambiguousCount = results.filter((r) => r.match_status === 'ambiguous').length;
  const unmatchedCount = results.filter((r) => r.match_status === 'unmatched').length;

  const reliableCount = exactIdCount + normalizedCount + variantCount + fuzzyCount;
  const coveredCount = reliableCount + ambiguousCount;

  const stats = {
    total,
    exact_id_matches: exactIdCount,
    normalized_matches: normalizedCount,
    variant_matches: variantCount,
    fuzzy_matches: fuzzyCount,
    ambiguous: ambiguousCount,
    unmatched: unmatchedCount,
    coverage_pct: total > 0 ? Math.round((coveredCount / total) * 1000) / 10 : 0,
    reliable_pct: total > 0 ? Math.round((reliableCount / total) * 1000) / 10 : 0,
  };

  return { results, stats };
}

// ─────────────────────────────────────────────────────────────────────────────
// Persistence — batch upsert to user_tracks
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Persist match results to user_tracks in a single bulk operation.
 *
 * Uses PostgreSQL's unnest() approach to upsert an arbitrary number of rows
 * in one round-trip.  The conflict target is (user_id, spotify_track_id, source)
 * so each source is treated as an independent track slot — intentional, because
 * a track appearing in both top_tracks and liked_songs carries different
 * temporal and weighting semantics.
 *
 * The played_at, added_at, and interaction_count columns are updated on conflict
 * so subsequent syncs reflect the latest listening data.
 *
 * @param {string} userId
 * @param {MatchResult[]} matchResults
 * @param {Date} [fetchedAt]
 */
async function persistUserTracks(userId, matchResults, fetchedAt) {
  if (!matchResults || matchResults.length === 0) return;
  const sql = getDb();
  const now = fetchedAt instanceof Date ? fetchedAt : new Date();

  // Deduplicate on (spotify_track_id, source) before sending to DB.
  // Within the same source, keep the entry with the highest interaction_count
  // (indicates most plays observed in the paginated batch).
  const dedupeKey = (r) => `${r.spotify_track_id}||${r.source || 'top_tracks'}`;
  const dedupedMap = new Map();
  for (const r of matchResults) {
    const key = dedupeKey(r);
    const existing = dedupedMap.get(key);
    if (!existing || (r.interaction_count || 1) > (existing.interaction_count || 1)) {
      dedupedMap.set(key, r);
    }
  }
  const rows = [...dedupedMap.values()];

  // Build typed arrays for unnest bulk insert
  const spotifyIds = rows.map((r) => r.spotify_track_id);
  const catalogIds = rows.map((r) => r.catalog_track_id || null);
  const statuses = rows.map((r) => r.match_status);
  const confidences = rows.map((r) => r.confidence ?? 0);
  const methods = rows.map((r) => r.matching_method || 'none');
  const sources = rows.map((r) => r.source || 'top_tracks');
  const trackNames = rows.map((r) => r.track_name || null);
  const artistNames = rows.map((r) => r.artist_name || null);
  const playedAts = rows.map((r) => r.played_at ? new Date(r.played_at) : null);
  const addedAts = rows.map((r) => r.added_at ? new Date(r.added_at) : null);
  const interactionCounts = rows.map((r) => Number(r.interaction_count) || 1);

  try {
    await sql`
      INSERT INTO user_tracks (
        user_id,
        spotify_track_id,
        catalog_track_id,
        match_status,
        match_confidence,
        matching_method,
        source,
        track_name,
        artist_name,
        played_at,
        added_at,
        interaction_count,
        spotify_fetched_at
      )
      SELECT
        ${userId}::uuid,
        t.spotify_track_id,
        t.catalog_track_id,
        t.match_status,
        t.match_confidence,
        t.matching_method,
        t.source,
        t.track_name,
        t.artist_name,
        t.played_at,
        t.added_at,
        t.interaction_count,
        ${now}
      FROM unnest(
        ${spotifyIds}::text[],
        ${catalogIds}::text[],
        ${statuses}::text[],
        ${confidences}::real[],
        ${methods}::text[],
        ${sources}::text[],
        ${trackNames}::text[],
        ${artistNames}::text[],
        ${playedAts}::timestamptz[],
        ${addedAts}::timestamptz[],
        ${interactionCounts}::integer[]
      ) AS t(
        spotify_track_id,
        catalog_track_id,
        match_status,
        match_confidence,
        matching_method,
        source,
        track_name,
        artist_name,
        played_at,
        added_at,
        interaction_count
      )
      ON CONFLICT (user_id, spotify_track_id, source) DO UPDATE SET
        catalog_track_id  = EXCLUDED.catalog_track_id,
        match_status      = EXCLUDED.match_status,
        match_confidence  = EXCLUDED.match_confidence,
        matching_method   = EXCLUDED.matching_method,
        track_name        = EXCLUDED.track_name,
        artist_name       = EXCLUDED.artist_name,
        played_at         = COALESCE(EXCLUDED.played_at, user_tracks.played_at),
        added_at          = COALESCE(EXCLUDED.added_at,  user_tracks.added_at),
        interaction_count = GREATEST(EXCLUDED.interaction_count, user_tracks.interaction_count),
        spotify_fetched_at = EXCLUDED.spotify_fetched_at
    `;
  } catch (err) {
    // Non-fatal: log and continue. Profile data is already computed in memory.
    console.warn('[trackMatcher] persistUserTracks bulk upsert warning:', err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Private helpers
// ─────────────────────────────────────────────────────────────────────────────

function _buildResult(w, catalogRow, status, confidence, method, allCandidates) {
  return {
    spotify_track_id: w.spotify_track_id,
    catalog_track_id: catalogRow ? catalogRow.track_id : null,
    match_status: status,
    confidence: Math.round(confidence * 10000) / 10000,
    matching_method: method,
    track_name: w.track_name,
    artist_name: w.artist_name,
    source: w.source,
    played_at: w.played_at ?? null,
    added_at: w.added_at ?? null,
    interaction_count: w.interaction_count,
    // Only populate when truly ambiguous — callers must not treat this as matched
    all_candidates: allCandidates
      ? allCandidates.map((c) => ({
          track_id: c.track_id,
          track_name: c.track_name,
          artist: c.track_artist,
          album: c.track_album_name,
          popularity: c.track_popularity,
          release_date: c.standard_release_date,
        }))
      : null,
  };
}

function _dedupeById(rows) {
  const seen = new Map();
  for (const r of rows) {
    if (!seen.has(r.track_id)) seen.set(r.track_id, r);
  }
  return [...seen.values()];
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  matchTracks,
  persistUserTracks,
  normalize,
  normalizeVariant,
  normalizeArtist,
  diceCoefficient,
  tiebreak,
  FUZZY_ACCEPT_THRESHOLD,
  DURATION_TOLERANCE_MS,
};

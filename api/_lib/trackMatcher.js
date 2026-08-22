/**
 * api/_lib/trackMatcher.js
 * Matches Spotify tracks against the MusicLens catalog (28,352 tracks in PostgreSQL).
 *
 * Matching priority (per spec):
 *  1. Exact Spotify track ID  → status: 'matched'     (highest confidence)
 *  2. Normalized name+artist  → status: 'ambiguous'   (medium confidence)
 *  3. No match                → status: 'unmatched'   (not in catalog)
 *
 * Rules:
 *  - Exact ID matches use the catalog's track_id column (already Spotify Base62 IDs).
 *  - Name+artist normalization: lowercase, collapse whitespace, strip punctuation.
 *  - If name+artist returns multiple catalog rows, status is 'ambiguous' (first row used).
 *  - Unmatched tracks still get stored for display; they are excluded from profile calc.
 *  - Never silently assumes a match — every result has an explicit status.
 *
 * Performance: bulk IDs are looked up in one query, name+artist in a second batch.
 */

'use strict';

const { getDb } = require('./db');

/** Normalize a string for loose matching: lowercase, collapse spaces, strip non-alphanumeric. */
function normalize(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')  // replace punctuation with space
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Match an array of Spotify track objects against the MusicLens catalog.
 *
 * @param {Array<{ spotify_track_id, track_name, artist_name, source }>} spotifyTracks
 * @returns {Promise<{
 *   results: Array<{ spotify_track_id, catalog_track_id|null, match_status, track_name, artist_name, source }>,
 *   stats: { total, matched, unmatched, ambiguous, coverage_pct }
 * }>}
 */
async function matchTracks(spotifyTracks) {
  if (!spotifyTracks || spotifyTracks.length === 0) {
    return { results: [], stats: { total: 0, matched: 0, unmatched: 0, ambiguous: 0, coverage_pct: 0 } };
  }

  const sql = getDb();

  // ── Step 1: Exact track_id lookup (batch) ─────────────────────────────
  const allIds = [...new Set(spotifyTracks.map((t) => t.spotify_track_id).filter(Boolean))];

  let exactMatches = new Map(); // spotify_track_id → catalog_track_id
  if (allIds.length > 0) {
    // Neon tagged template doesn't support array parameters directly;
    // use unnest for batch lookup
    const rows = await sql`
      SELECT track_id
      FROM tracks
      WHERE track_id = ANY(${allIds})
    `;
    for (const row of rows) {
      exactMatches.set(row.track_id, row.track_id);
    }
  }

  // ── Step 2: Name+artist lookup for non-exact-matched tracks ───────────
  const needsNameMatch = spotifyTracks.filter(
    (t) => !exactMatches.has(t.spotify_track_id)
  );

  // Deduplicate by normalized name+artist to minimize DB queries
  const nameArtistPairs = [];
  const seenPairs = new Set();
  for (const t of needsNameMatch) {
    const key = `${normalize(t.track_name)}|||${normalize(t.artist_name)}`;
    if (!seenPairs.has(key)) {
      seenPairs.add(key);
      nameArtistPairs.push({ normName: normalize(t.track_name), normArtist: normalize(t.artist_name), key });
    }
  }

  // Map from "normName|||normArtist" → catalog_track_id (or null if none/ambiguous)
  const nameArtistMatches = new Map();

  if (nameArtistPairs.length > 0) {
    // Batch the lookup using a VALUES list
    // We join tracks + artists and match on lowercased name + artist_name
    for (const { normName, normArtist, key } of nameArtistPairs) {
      if (!normName) {
        nameArtistMatches.set(key, { track_id: null, ambiguous: false });
        continue;
      }
      try {
        const rows = await sql`
          SELECT t.track_id
          FROM tracks t
          JOIN artists a ON a.artist_id = t.artist_id
          WHERE lower(regexp_replace(t.track_name, '[^\\w\\s]', ' ', 'g')) = ${normName}
            AND lower(regexp_replace(a.artist_name, '[^\\w\\s]', ' ', 'g')) = ${normArtist}
          LIMIT 2
        `;
        if (rows.length === 0) {
          nameArtistMatches.set(key, { track_id: null, ambiguous: false });
        } else if (rows.length === 1) {
          nameArtistMatches.set(key, { track_id: rows[0].track_id, ambiguous: true }); // name match = ambiguous
        } else {
          // Multiple catalog rows with same name+artist → ambiguous, take first
          nameArtistMatches.set(key, { track_id: rows[0].track_id, ambiguous: true });
        }
      } catch {
        nameArtistMatches.set(key, { track_id: null, ambiguous: false });
      }
    }
  }

  // ── Assemble results ───────────────────────────────────────────────────
  const results = spotifyTracks.map((t) => {
    const sid = t.spotify_track_id;

    if (exactMatches.has(sid)) {
      return {
        spotify_track_id: sid,
        catalog_track_id: exactMatches.get(sid),
        match_status: 'matched',
        track_name: t.track_name,
        artist_name: t.artist_name,
        source: t.source,
      };
    }

    const key = `${normalize(t.track_name)}|||${normalize(t.artist_name)}`;
    const nameMatch = nameArtistMatches.get(key);
    if (nameMatch && nameMatch.track_id) {
      return {
        spotify_track_id: sid,
        catalog_track_id: nameMatch.track_id,
        match_status: 'ambiguous',
        track_name: t.track_name,
        artist_name: t.artist_name,
        source: t.source,
      };
    }

    return {
      spotify_track_id: sid,
      catalog_track_id: null,
      match_status: 'unmatched',
      track_name: t.track_name,
      artist_name: t.artist_name,
      source: t.source,
    };
  });

  // ── Stats ──────────────────────────────────────────────────────────────
  const total = results.length;
  const matched = results.filter((r) => r.match_status === 'matched').length;
  const ambiguous = results.filter((r) => r.match_status === 'ambiguous').length;
  const unmatched = results.filter((r) => r.match_status === 'unmatched').length;
  const coverage_pct = total > 0 ? Math.round(((matched + ambiguous) / total) * 100 * 10) / 10 : 0;

  return {
    results,
    stats: { total, matched, unmatched, ambiguous, coverage_pct },
  };
}

/**
 * Persist match results to user_tracks table.
 * Uses INSERT ... ON CONFLICT DO UPDATE to handle re-syncs.
 */
async function persistUserTracks(userId, matchResults, fetchedAt) {
  if (matchResults.length === 0) return;
  const sql = getDb();
  const now = fetchedAt || new Date();

  // Batch upsert in chunks of 50 to stay within Neon query limits
  const CHUNK = 50;
  for (let i = 0; i < matchResults.length; i += CHUNK) {
    const chunk = matchResults.slice(i, i + CHUNK);
    for (const r of chunk) {
      await sql`
        INSERT INTO user_tracks (
          user_id, spotify_track_id, catalog_track_id,
          match_status, source, track_name, artist_name, spotify_fetched_at
        )
        VALUES (
          ${userId}, ${r.spotify_track_id}, ${r.catalog_track_id},
          ${r.match_status}, ${r.source}, ${r.track_name || null}, ${r.artist_name || null},
          ${now}
        )
        ON CONFLICT (user_id, spotify_track_id, source) DO UPDATE SET
          catalog_track_id   = EXCLUDED.catalog_track_id,
          match_status       = EXCLUDED.match_status,
          track_name         = EXCLUDED.track_name,
          artist_name        = EXCLUDED.artist_name,
          spotify_fetched_at = EXCLUDED.spotify_fetched_at
      `;
    }
  }
}

module.exports = { matchTracks, persistUserTracks, normalize };

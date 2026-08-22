/**
 * server/routes/profile/refresh.js
 * POST /api/profile/refresh
 *
 * Full Spotify → MusicLens profile generation pipeline (Phase 4).
 *
 * Pipeline stages
 * ───────────────
 * 1.  Validate MusicLens session.
 * 2.  Verify spotify_connections row exists.
 * 3.  Fetch Spotify data with pagination (spotifyClient):
 *       top_tracks     — 3 time ranges × 50, deduped by ID within source
 *       recently_played — cursor-paged (default 3 × 50 = up to 150)
 *       liked_songs    — offset-paged  (default 4 × 50 = up to 200)
 *       top_artists    — 50, for genre inference
 * 4.  Cross-source deduplication:
 *       A single Spotify track ID may appear in multiple sources.
 *       Sources are kept SEPARATE — the matcher receives one entry per
 *       (spotify_track_id × source) pair so the taste profile can weight
 *       each source independently. No source is silently discarded.
 * 5.  4-stage entity resolution (trackMatcher.matchTracks):
 *       Stage 1 — exact track ID   (confidence 1.00)
 *       Stage 2 — normalized name+artist (0.95)
 *       Stage 3 — variant normalization  (0.85)
 *       Stage 4 — fuzzy trigram, artist-scoped, threshold 0.82
 *       Ambiguous results carry all_candidates and are not silently accepted.
 * 6.  Batch-load catalog audio features for matched/ambiguous tracks (one query).
 * 7.  Load in-app manual likes as an additional taste source.
 * 8.  Derive track features + calculate taste profile + archetype.
 * 9.  Upsert user_profile_data (single query, preserves existing row on error).
 * 10. Non-blocking bulk persist to user_tracks (unnest upsert, one query).
 * 11. Return response — shape identical to previous version for API compatibility.
 *
 * Response shape (HTTP 200)
 * ─────────────────────────
 * {
 *   hasProfile:   boolean,
 *   profile:      { …same keys as before… },
 *   stats: {
 *     total, matched, unmatched, ambiguous, coverage_pct,   // legacy keys preserved
 *     exact_id_matches, normalized_matches, variant_matches,
 *     fuzzy_matches, reliable_pct,                          // new keys
 *   },
 *   ingestionStats: { top_tracks_count, recently_played_count,
 *                     liked_songs_count, total_raw, unique_spotify_ids },
 *   syncedAt: ISO string,
 * }
 */

'use strict';

const { validateSession } = require('../../lib/session');
const { getDb } = require('../../lib/db');
const { sendJson } = require('../../lib/validate');
const {
  fetchAllUserMusic,
  SpotifyAuthError,
  SpotifyRateLimitError,
} = require('../../lib/spotifyClient');
const { matchTracks, persistUserTracks } = require('../../lib/trackMatcher');
const {
  deriveTrackFeatures,
  calculateProfile,
} = require('../../lib/profileCalculator');

module.exports = async function refreshProfile(req, res) {
  const tTotalStart = Date.now();

  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }

  const requiredEnv = [
    'DATABASE_URL', 'TOKEN_ENCRYPTION_KEY',
    'SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET',
  ];
  if (requiredEnv.some((k) => !process.env[k])) {
    return sendJson(res, 500, { error: 'Server configuration error.' });
  }

  // ── 1. Auth guard ──────────────────────────────────────────────────────
  let session;
  try {
    session = await validateSession(req);
  } catch (err) {
    console.error('[profile/refresh] session error:', err.message);
    return sendJson(res, 500, { error: 'Server error.' });
  }
  if (!session) return sendJson(res, 401, { error: 'Not authenticated.' });

  const sql = getDb();

  // ── 2. Verify Spotify connection ───────────────────────────────────────
  const connRows = await sql`
    SELECT user_id FROM spotify_connections
    WHERE user_id = ${session.userId}
    LIMIT 1
  `.catch(() => []);

  if (connRows.length === 0) {
    return sendJson(res, 400, {
      error: 'Spotify is not connected. Please connect your Spotify account first.',
    });
  }

  // ── 3. Fetch Spotify data (paginated) ──────────────────────────────────
  const tSpotifyStart = Date.now();
  let spotifyResult;
  try {
    spotifyResult = await fetchAllUserMusic(session.userId);
  } catch (err) {
    if (err instanceof SpotifyAuthError) return sendJson(res, 401, { error: err.message });
    if (err instanceof SpotifyRateLimitError) return sendJson(res, 429, { error: err.message });
    console.error('[profile/refresh] Spotify fetch error:', err.message);
    return sendJson(res, 502, { error: 'Could not retrieve your Spotify music data.' });
  }

  const tSpotify = Date.now() - tSpotifyStart;
  const {
    topTracks = [],
    recentTracks = [],
    likedSongs = [],
    topArtists = [],
    tracks = [],
    ingestionStats = { total_raw: 0 },
  } = spotifyResult || {};

  console.log(
    `[profile/refresh] Spotify fetch: ${tSpotify}ms | ` +
    `top=${topTracks.length} recent=${recentTracks.length} liked=${likedSongs.length}`
  );

  const totalRawCount = ingestionStats.total_raw ?? (topTracks.length + recentTracks.length + likedSongs.length + tracks.length);

  // Early exit: no data at all
  if (totalRawCount === 0) {
    return sendJson(res, 200, {
      hasProfile: false,
      message: 'No Spotify listening data found. Try listening to more music and refreshing.',
      stats: { total: 0, matched: 0, unmatched: 0, ambiguous: 0, coverage_pct: 0 },
      ingestionStats,
    });
  }

  // ── 4. Cross-source deduplication before matching ─────────────────────
  //
  // Policy: a track may validly appear in multiple sources (top_tracks AND
  // liked_songs is common). We pass one entry per (track_id × source) pair to
  // the matcher so that each source slot is independently matched and later
  // weighted by the taste-aggregation layer.
  //
  // Phase 5: time_range is preserved on top_tracks entries so tasteProfile.js
  // can route short_term / medium_term / long_term into separate weight buckets.

  const allSourcedTracks = (topTracks.length || recentTracks.length || likedSongs.length)
    ? [
        ...topTracks.map((t) => ({ ...t, source: 'top_tracks' })),
        ...recentTracks.map((t) => ({ ...t, source: 'recently_played' })),
        ...likedSongs.map((t) => ({ ...t, source: 'liked_songs' })),
      ]
    : tracks.map((t) => ({ ...t, source: t.source || 'top_tracks' }));

  // ── 5. Entity resolution (4-stage pipeline) ───────────────────────────
  const tMatchStart = Date.now();
  let matchResults, matchStats;
  try {
    const matchOutput = await matchTracks(allSourcedTracks);
    matchResults = matchOutput.results;
    matchStats = matchOutput.stats;
  } catch (err) {
    console.error('[profile/refresh] matchTracks error:', err.message);
    // Degrade gracefully: treat all as unmatched so profile still builds
    matchResults = allSourcedTracks.map((t) => ({
      spotify_track_id: t.spotify_track_id,
      catalog_track_id: null,
      match_status: 'unmatched',
      confidence: 0,
      matching_method: 'none',
      track_name: t.track_name,
      artist_name: t.artist_name,
      source: t.source,
      played_at: t.played_at ?? null,
      added_at: t.added_at ?? null,
      interaction_count: t.interaction_count || 1,
      all_candidates: null,
    }));
    matchStats = {
      total: allSourcedTracks.length,
      exact_id_matches: 0, normalized_matches: 0,
      variant_matches: 0, fuzzy_matches: 0,
      ambiguous: 0, unmatched: allSourcedTracks.length,
      coverage_pct: 0, reliable_pct: 0,
    };
  }

  const tMatch = Date.now() - tMatchStart;
  console.log(
    `[profile/refresh] Matching: ${tMatch}ms | ` +
    `exact=${matchStats.exact_id_matches} norm=${matchStats.normalized_matches} ` +
    `variant=${matchStats.variant_matches} fuzzy=${matchStats.fuzzy_matches} ` +
    `ambiguous=${matchStats.ambiguous} unmatched=${matchStats.unmatched}`
  );

  // ── 6. Batch-load catalog features for matched/ambiguous tracks ────────
  const tMlStart = Date.now();

  // Collect catalog_track_ids from all matched + ambiguous results (deduplicated)
  const catalogIdsNeeded = [
    ...new Set(
      matchResults
        .filter((r) => r.catalog_track_id && r.match_status !== 'unmatched')
        .map((r) => r.catalog_track_id)
    ),
  ];

  const catalogTrackMap = new Map();
  if (catalogIdsNeeded.length > 0) {
    try {
      const catalogRows = await sql`
        SELECT
          tfv.track_id,
          tfv.track_name,
          tfv.artist_name,
          tfv.genre_name,
          tfv.danceability,
          tfv.energy,
          tfv.loudness,
          tfv.speechiness,
          tfv.acousticness,
          tfv.instrumentalness,
          tfv.liveness,
          tfv.valence,
          tfv.tempo
        FROM track_feature_vectors tfv
        WHERE tfv.track_id = ANY(${catalogIdsNeeded})
      `;
      for (const row of catalogRows) catalogTrackMap.set(row.track_id, row);
    } catch (err) {
      console.warn('[profile/refresh] track_feature_vectors lookup warning:', err.message);
    }
  }

  // For tracks where the catalog lookup failed, fall back to the artist-average
  // stats table — same as before, but now we only query for artists not already
  // covered by the catalog feature lookup.
  const catalogArtistMap = new Map();
  const artistsNeedingFallback = [
    ...new Set(
      matchResults
        .filter((r) => r.match_status !== 'unmatched' && r.catalog_track_id && !catalogTrackMap.has(r.catalog_track_id))
        .map((r) => (r.artist_name || '').toLowerCase().trim())
        .filter(Boolean)
    ),
  ];

  if (artistsNeedingFallback.length > 0) {
    try {
      const artistRows = await sql`
        SELECT
          LOWER(artist_name) AS artist_name,
          genre_primary AS genre_name,
          avg_danceability AS danceability,
          avg_energy      AS energy,
          avg_valence     AS valence
        FROM artist_stats
        WHERE LOWER(artist_name) = ANY(${artistsNeedingFallback})
      `;
      for (const r of artistRows) catalogArtistMap.set(r.artist_name, r);
    } catch {
      // Non-fatal — genre taxonomy fallback will apply
    }
  }

  // ── 7. Load in-app manual likes ────────────────────────────────────────
  const manualTasteTracks = await sql`
    SELECT
      ult.catalog_track_id,
      ult.liked_at,
      af.danceability, af.energy, af.loudness, af.speechiness,
      af.acousticness, af.instrumentalness, af.liveness, af.valence, af.tempo
    FROM user_liked_tracks ult
    JOIN audio_features af ON af.track_id = ult.catalog_track_id
    WHERE ult.user_id = ${session.userId}
    LIMIT 200
  `.then((rows) =>
    rows.map((row) => ({
      ...row,
      track_id: row.catalog_track_id,
      source: 'manual',
      added_at: row.liked_at,
      interaction_count: 1,
    }))
  ).catch(() => []);

  // ── 8. Feature derivation + profile calculation ────────────────────────
  //
  // deriveTrackFeatures expects the flat track list in the shape that
  // profileCalculator has always consumed.  We translate matchResults into
  // that shape, attaching catalog features where available.
  //
  // Ambiguous matches ARE included in the profile — they carry real audio
  // features from the best-guess catalog match.  Their presence in stats
  // (tracks_ambiguous) signals to the UI that some tracks may be misidentified.

  const tracksForDerivation = matchResults.map((r) => ({
    spotify_track_id: r.spotify_track_id,
    track_name: r.track_name,
    artist_name: r.artist_name,
    source: r.source,
    played_at: r.played_at ?? null,
    added_at: r.added_at ?? null,
    interaction_count: r.interaction_count || 1,
    // Catalog data attached if matched/ambiguous
    ...(r.catalog_track_id && catalogTrackMap.has(r.catalog_track_id)
      ? { _catalog: catalogTrackMap.get(r.catalog_track_id) }
      : {}),
  }));

  // Build catalogTrackMap keyed by spotify_track_id for deriveTrackFeatures
  // (it expects spotify_track_id → catalog row, as before)
  const catalogBySpotifyId = new Map();
  for (const r of matchResults) {
    if (r.catalog_track_id && catalogTrackMap.has(r.catalog_track_id)) {
      catalogBySpotifyId.set(r.spotify_track_id, catalogTrackMap.get(r.catalog_track_id));
    }
  }

  const { derivedTracks, stats: derivedStats } = deriveTrackFeatures(
    tracksForDerivation,
    topArtists,
    catalogBySpotifyId,
    catalogArtistMap
  );

  // Merge match pipeline stats into derivedStats for the response
  const combinedStats = {
    // Legacy keys (preserved for API compatibility)
    total: matchStats.total,
    matched: matchStats.exact_id_matches + matchStats.normalized_matches +
             matchStats.variant_matches + matchStats.fuzzy_matches,
    unmatched: matchStats.unmatched,
    ambiguous: matchStats.ambiguous,
    coverage_pct: matchStats.coverage_pct,
    // New Phase 4 keys
    exact_id_matches: matchStats.exact_id_matches,
    normalized_matches: matchStats.normalized_matches,
    variant_matches: matchStats.variant_matches,
    fuzzy_matches: matchStats.fuzzy_matches,
    reliable_pct: matchStats.reliable_pct,
  };

  const profile = calculateProfile(
    derivedTracks,
    combinedStats,
    topArtists,
    manualTasteTracks
  );

  const syncedAt = new Date();
  const tMl = Date.now() - tMlStart;
  console.log(`[profile/refresh] Feature extraction / ML: ${tMl}ms`);

  // ── 9. Upsert user_profile_data ────────────────────────────────────────
  const tPersistStart = Date.now();
  try {
    await sql`
      INSERT INTO user_profile_data (
        user_id,
        tracks_analyzed, tracks_matched, tracks_unmatched, tracks_ambiguous, coverage_pct,
        audio_profile, raw_feature_means, preference_vector, taste_representation,
        dominant_genres, dominant_subgenres, top_artists, mood_distribution,
        archetype, archetype_tagline, archetype_desc,
        last_spotify_sync, last_refreshed_at
      )
      VALUES (
        ${session.userId},
        ${profile.tracks_analyzed}, ${profile.tracks_matched},
        ${profile.tracks_unmatched}, ${profile.tracks_ambiguous}, ${profile.coverage_pct},
        ${JSON.stringify(profile.audio_profile)},
        ${JSON.stringify(profile.raw_feature_means)},
        ${JSON.stringify(profile.preference_vector)},
        ${JSON.stringify(profile.taste_representation)},
        ${JSON.stringify(profile.dominant_genres)},
        ${JSON.stringify(profile.dominant_subgenres)},
        ${JSON.stringify(profile.top_artists)},
        ${JSON.stringify(profile.mood_distribution)},
        ${profile.archetype}, ${profile.archetype_tagline}, ${profile.archetype_desc},
        ${syncedAt}, NOW()
      )
      ON CONFLICT (user_id) DO UPDATE SET
        tracks_analyzed      = EXCLUDED.tracks_analyzed,
        tracks_matched       = EXCLUDED.tracks_matched,
        tracks_unmatched     = EXCLUDED.tracks_unmatched,
        tracks_ambiguous     = EXCLUDED.tracks_ambiguous,
        coverage_pct         = EXCLUDED.coverage_pct,
        audio_profile        = EXCLUDED.audio_profile,
        raw_feature_means    = EXCLUDED.raw_feature_means,
        preference_vector    = EXCLUDED.preference_vector,
        taste_representation = EXCLUDED.taste_representation,
        dominant_genres      = EXCLUDED.dominant_genres,
        dominant_subgenres   = EXCLUDED.dominant_subgenres,
        top_artists          = EXCLUDED.top_artists,
        mood_distribution    = EXCLUDED.mood_distribution,
        archetype            = EXCLUDED.archetype,
        archetype_tagline    = EXCLUDED.archetype_tagline,
        archetype_desc       = EXCLUDED.archetype_desc,
        last_spotify_sync    = EXCLUDED.last_spotify_sync,
        last_refreshed_at    = NOW()
    `;
  } catch (err) {
    console.error('[profile/refresh] upsert user_profile_data error:', err.message);
    // Profile is already computed in memory — continue and return it.
  }

  // ── 10. Non-blocking bulk persist of user_tracks ───────────────────────
  //
  // Passes full matchResults (with played_at, added_at, interaction_count,
  // match_confidence, matching_method) to the unnest-based bulk upsert.
  // Fire-and-forget — a failure here does not affect the response.
  persistUserTracks(session.userId, matchResults, syncedAt).catch((err) => {
    console.warn('[profile/refresh] async user_tracks persist warning:', err.message);
  });

  const tPersist = Date.now() - tPersistStart;
  const tTotal = Date.now() - tTotalStart;
  console.log(
    `[profile/refresh] Persist: ${tPersist}ms | Total: ${tTotal}ms`
  );

  // ── 11. Response ───────────────────────────────────────────────────────
  return sendJson(res, 200, {
    hasProfile: derivedTracks.length > 0,
    profile,
    stats: combinedStats,
    ingestionStats,
    // Phase 5: surfaced at the top level so frontend can gate features on profile quality
    // without parsing taste_representation.quality.
    profile_quality: profile.profile_quality ?? null,
    preference_vector_source: profile.preference_vector_source ?? 'baseline_mean',
    syncedAt: syncedAt.toISOString(),
  });
};

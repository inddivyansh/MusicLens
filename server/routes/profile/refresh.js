/**
 * server/routes/profile/refresh.js
 * POST /api/profile/refresh
 * Direct Spotify → MusicLens ML profile generation pipeline.
 *
 * Replaces expensive per-track/per-artist database scans with:
 *  1. Parallel Spotify data retrieval (tracks + top artists)
 *  2. Fast single-batch catalog feature lookup + in-memory ML feature extraction
 *  3. MusicLens taste profile calculation (archetype, audio profile, genres, top artists)
 *  4. Single profile upsert + non-blocking background track persistence
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
const { persistUserTracks } = require('../../lib/trackMatcher');
const {
  deriveTrackFeatures,
  calculateProfile,
} = require('../../lib/profileCalculator');

module.exports = async function refreshProfile(req, res) {
  const tTotalStart = Date.now();

  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }

  const requiredEnv = ['DATABASE_URL', 'TOKEN_ENCRYPTION_KEY', 'SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET'];
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
    SELECT user_id FROM spotify_connections WHERE user_id = ${session.userId} LIMIT 1
  `.catch(() => []);

  if (connRows.length === 0) {
    return sendJson(res, 400, {
      error: 'Spotify is not connected. Please connect your Spotify account first.',
    });
  }

  // ── 3. Fetch Spotify music data ────────────────────────────────────────
  const tSpotifyStart = Date.now();
  let spotifyResult;
  try {
    spotifyResult = await fetchAllUserMusic(session.userId);
  } catch (err) {
    if (err instanceof SpotifyAuthError) {
      return sendJson(res, 401, { error: err.message });
    }
    if (err instanceof SpotifyRateLimitError) {
      return sendJson(res, 429, { error: err.message });
    }
    console.error('[profile/refresh] Spotify fetch error:', err.message);
    return sendJson(res, 502, { error: 'Could not retrieve your Spotify music data.' });
  }

  const tSpotify = Date.now() - tSpotifyStart;
  console.log(`[profile/refresh]\nSpotify fetch: ${tSpotify} ms`);

  const spotifyTracks = Array.isArray(spotifyResult)
    ? spotifyResult
    : (spotifyResult?.tracks || []);
  const spotifyTopArtists = Array.isArray(spotifyResult)
    ? []
    : (spotifyResult?.topArtists || []);

  if (!spotifyTracks || spotifyTracks.length === 0) {
    const tTotal = Date.now() - tTotalStart;
    console.log(`[profile/refresh]\nFeature extraction / ML: 0 ms`);
    console.log(`[profile/refresh]\nProfile persistence: 0 ms`);
    console.log(`[profile/refresh]\nTotal: ${tTotal} ms`);
    return sendJson(res, 200, {
      hasProfile: false,
      message: 'No Spotify listening data found. Try listening to more music and refreshing.',
      stats: { total: 0, matched: 0, unmatched: 0, ambiguous: 0, coverage_pct: 0 },
    });
  }

  // ── 4. Feature extraction / ML ─────────────────────────────────────────
  const tMlStart = Date.now();
  const uniqueTrackIds = [...new Set(spotifyTracks.map((t) => t.spotify_track_id).filter(Boolean))];

  // Single batch lookup for exact catalog tracks
  const catalogTrackMap = new Map();
  if (uniqueTrackIds.length > 0) {
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
        WHERE tfv.track_id = ANY(${uniqueTrackIds})
      `;
      for (const row of catalogRows) {
        catalogTrackMap.set(row.track_id, row);
      }
    } catch (err) {
      console.warn('[profile/refresh] track_feature_vectors lookup warning:', err.message);
    }
  }

  // Single batch lookup for unmatched artist averages in catalog
  const catalogArtistMap = new Map();
  const unmatchedArtists = [
    ...new Set(
      spotifyTracks
        .filter((t) => !catalogTrackMap.has(t.spotify_track_id))
        .map((t) => (t.artist_name || '').toLowerCase().trim())
        .filter(Boolean)
    ),
  ];

  if (unmatchedArtists.length > 0) {
    try {
      const artistRows = await sql`
        SELECT
          LOWER(artist_name) AS artist_name,
          genre_primary AS genre_name,
          avg_danceability AS danceability,
          avg_energy AS energy,
          avg_valence AS valence
        FROM artist_stats
        WHERE LOWER(artist_name) = ANY(${unmatchedArtists})
      `;
      for (const r of artistRows) {
        catalogArtistMap.set(r.artist_name, r);
      }
    } catch (err) {
      // Non-fatal fallback to genre taxonomy
    }
  }

  // In-memory ML feature derivation
  const { derivedTracks, stats } = deriveTrackFeatures(
    spotifyTracks,
    spotifyTopArtists,
    catalogTrackMap,
    catalogArtistMap
  );

  // Compute rich taste profile & archetype
  const profile = calculateProfile(derivedTracks, stats, spotifyTopArtists);
  const syncedAt = new Date();

  const tMl = Date.now() - tMlStart;
  console.log(`[profile/refresh]\nFeature extraction / ML: ${tMl} ms`);

  // ── 5. Profile persistence ─────────────────────────────────────────────
  const tPersistStart = Date.now();
  try {
    await sql`
      INSERT INTO user_profile_data (
        user_id,
        tracks_analyzed, tracks_matched, tracks_unmatched, tracks_ambiguous, coverage_pct,
        audio_profile, raw_feature_means, preference_vector,
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
        ${JSON.stringify(profile.dominant_genres)},
        ${JSON.stringify(profile.dominant_subgenres)},
        ${JSON.stringify(profile.top_artists)},
        ${JSON.stringify(profile.mood_distribution)},
        ${profile.archetype}, ${profile.archetype_tagline}, ${profile.archetype_desc},
        ${syncedAt}, NOW()
      )
      ON CONFLICT (user_id) DO UPDATE SET
        tracks_analyzed    = EXCLUDED.tracks_analyzed,
        tracks_matched     = EXCLUDED.tracks_matched,
        tracks_unmatched   = EXCLUDED.tracks_unmatched,
        tracks_ambiguous   = EXCLUDED.tracks_ambiguous,
        coverage_pct       = EXCLUDED.coverage_pct,
        audio_profile      = EXCLUDED.audio_profile,
        raw_feature_means  = EXCLUDED.raw_feature_means,
        preference_vector  = EXCLUDED.preference_vector,
        dominant_genres    = EXCLUDED.dominant_genres,
        dominant_subgenres = EXCLUDED.dominant_subgenres,
        top_artists        = EXCLUDED.top_artists,
        mood_distribution  = EXCLUDED.mood_distribution,
        archetype          = EXCLUDED.archetype,
        archetype_tagline  = EXCLUDED.archetype_tagline,
        archetype_desc     = EXCLUDED.archetype_desc,
        last_spotify_sync  = EXCLUDED.last_spotify_sync,
        last_refreshed_at  = NOW()
    `;
  } catch (err) {
    console.error('[profile/refresh] upsert user_profile_data warning:', err.message);
  }

  // Non-blocking batch persist of user_tracks
  persistUserTracks(
    session.userId,
    derivedTracks.map((t) => ({
      spotify_track_id: t.track_id,
      catalog_track_id: t.catalog_track_id,
      match_status: t.match_status,
      source: t.source,
      track_name: t.track_name,
      artist_name: t.artist_name,
    })),
    syncedAt
  ).catch((err) => {
    console.warn('[profile/refresh] async user_tracks persist warning:', err.message);
  });

  const tPersist = Date.now() - tPersistStart;
  console.log(`[profile/refresh]\nProfile persistence: ${tPersist} ms`);

  const tTotal = Date.now() - tTotalStart;
  console.log(`[profile/refresh]\nTotal: ${tTotal} ms`);

  // ── 6. Return response ─────────────────────────────────────────────────
  return sendJson(res, 200, {
    hasProfile: derivedTracks.length > 0,
    profile,
    stats,
    syncedAt: syncedAt.toISOString(),
  });
};


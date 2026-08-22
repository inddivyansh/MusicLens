/**
 * POST /api/profile/refresh
 * Full Spotify → MusicLens profile pipeline for one user.
 *
 * Steps:
 *  1. Authenticate MusicLens session.
 *  2. Verify Spotify is connected.
 *  3. Retrieve permitted Spotify music data (top tracks, recently played, liked songs).
 *  4. Match each track against the MusicLens catalog (exact ID → name+artist → unmatched).
 *  5. Persist match results to user_tracks.
 *  6. Load audio features for matched/ambiguous catalog tracks.
 *  7. Calculate profile using profileCalculator.js (JS port of Python logic).
 *  8. Persist/update user_profile_data.
 *  9. Return the new profile.
 *
 * Does NOT train a model. The recommendation methodology is the existing
 * 30K-song dataset. Spotify data only selects seed tracks for profile calculation.
 *
 * Tokens are never returned or logged.
 */

'use strict';

const { validateSession } = require('../_lib/session');
const { getDb } = require('../_lib/db');
const { sendJson } = require('../_lib/validate');
const { fetchAllUserMusic, SpotifyAuthError, SpotifyRateLimitError } = require('../_lib/spotifyClient');
const { matchTracks, persistUserTracks } = require('../_lib/trackMatcher');
const { calculateProfile } = require('../_lib/profileCalculator');

module.exports = async function refreshProfile(req, res) {
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
  let spotifyTracks;
  try {
    spotifyTracks = await fetchAllUserMusic(session.userId);
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

  if (!spotifyTracks || spotifyTracks.length === 0) {
    return sendJson(res, 200, {
      hasProfile: false,
      message: 'No Spotify listening data found. Try listening to more music and refreshing.',
      stats: { total: 0, matched: 0, unmatched: 0, ambiguous: 0, coverage_pct: 0 },
    });
  }

  // ── 4. Match tracks against MusicLens catalog ──────────────────────────
  let matchResult;
  try {
    matchResult = await matchTracks(spotifyTracks);
  } catch (err) {
    console.error('[profile/refresh] matching error:', err.message);
    return sendJson(res, 500, { error: 'Track matching failed.' });
  }

  const { results: matchedResults, stats } = matchResult;
  const syncedAt = new Date();

  // ── 5. Persist match results ───────────────────────────────────────────
  try {
    await persistUserTracks(session.userId, matchedResults, syncedAt);
  } catch (err) {
    console.error('[profile/refresh] persist user_tracks error:', err.message);
    // Non-fatal — continue to profile calculation
  }

  // ── 6. Load audio features for matched + ambiguous catalog tracks ──────
  const catalogIds = matchedResults
    .filter((r) => r.catalog_track_id && (r.match_status === 'matched' || r.match_status === 'ambiguous'))
    .map((r) => r.catalog_track_id);

  // Deduplicate catalog IDs (same catalog track from multiple Spotify sources)
  const uniqueCatalogIds = [...new Set(catalogIds)];

  let audioRows = [];
  if (uniqueCatalogIds.length > 0) {
    try {
      // Pull audio features + artist name + genre from the materialized view
      audioRows = await sql`
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
        WHERE tfv.track_id = ANY(${uniqueCatalogIds})
      `;
    } catch (err) {
      // Materialized view may not exist in dev — fall back to base tables
      console.warn('[profile/refresh] track_feature_vectors unavailable, falling back:', err.message);
      try {
        audioRows = await sql`
          SELECT
            t.track_id,
            t.track_name,
            a.artist_name,
            g.genre_name,
            af.danceability, af.energy, af.loudness, af.speechiness,
            af.acousticness, af.instrumentalness, af.liveness, af.valence, af.tempo
          FROM tracks t
          JOIN artists a       ON a.artist_id = t.artist_id
          JOIN audio_features af ON af.track_id = t.track_id
          LEFT JOIN playlist_tracks pt ON pt.track_id = t.track_id
          LEFT JOIN genres g   ON g.genre_id = pt.genre_id
          WHERE t.track_id = ANY(${uniqueCatalogIds})
        `;
      } catch (err2) {
        console.error('[profile/refresh] audio features query failed:', err2.message);
        return sendJson(res, 500, { error: 'Could not load audio features from catalog.' });
      }
    }
  }

  // ── 7. Calculate profile ───────────────────────────────────────────────
  // Pass the full stats (including unmatched count) but only matched audio rows
  const profile = calculateProfile(audioRows, {
    total: stats.total,
    matched: stats.matched,
    unmatched: stats.unmatched,
    ambiguous: stats.ambiguous,
    coverage_pct: stats.coverage_pct,
  });

  // ── 8. Persist / update user_profile_data ─────────────────────────────
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
    console.error('[profile/refresh] upsert user_profile_data error:', err.message);
    return sendJson(res, 500, { error: 'Could not save profile.' });
  }

  // ── 9. Return new profile ──────────────────────────────────────────────
  return sendJson(res, 200, {
    hasProfile: audioRows.length > 0,
    profile,
    stats,
    syncedAt: syncedAt.toISOString(),
  });
};

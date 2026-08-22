/**
 * server/routes/profile/index.js
 * GET /api/profile
 * Returns the persisted MusicLens profile for the authenticated user.
 * Does NOT call Spotify on every request — returns the last computed profile.
 */

'use strict';

const { validateSession } = require('../../lib/session');
const { getDb } = require('../../lib/db');
const { sendJson } = require('../../lib/validate');

module.exports = async function getProfile(req, res) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }

  if (!process.env.DATABASE_URL) {
    return sendJson(res, 500, { error: 'Server configuration error.' });
  }

  // ── Auth guard ─────────────────────────────────────────────────────────
  let session;
  try {
    session = await validateSession(req);
  } catch (err) {
    console.error('[profile/get] session error:', err.message);
    return sendJson(res, 500, { error: 'Server error.' });
  }
  if (!session) return sendJson(res, 401, { error: 'Not authenticated.' });

  const sql = getDb();

  // ── Fetch profile + Spotify status + liked count in parallel ──────────
  let profileRow, spotifyRow, likedCount;
  try {
    [profileRow, spotifyRow, likedCount] = await Promise.all([
      sql`
        SELECT
          tracks_analyzed, tracks_matched, tracks_unmatched, tracks_ambiguous,
          coverage_pct, audio_profile, raw_feature_means, preference_vector,
          dominant_genres, dominant_subgenres, top_artists, mood_distribution,
          archetype, archetype_tagline, archetype_desc,
          last_spotify_sync, last_refreshed_at
        FROM user_profile_data
        WHERE user_id = ${session.userId}
        LIMIT 1
      `.then((rows) => rows[0] || null),

      sql`
        SELECT display_name FROM spotify_connections
        WHERE user_id = ${session.userId}
        LIMIT 1
      `.then((rows) => rows[0] || null),

      sql`
        SELECT COUNT(*) AS cnt FROM user_liked_tracks
        WHERE user_id = ${session.userId}
      `.then((rows) => parseInt(rows[0]?.cnt || '0', 10)),
    ]);
  } catch (err) {
    console.error('[profile/get] DB error:', err.message);
    return sendJson(res, 500, { error: 'Server error.' });
  }

  return sendJson(res, 200, {
    hasProfile: profileRow !== null,
    spotifyConnected: spotifyRow !== null,
    spotifyDisplayName: spotifyRow?.display_name || null,
    likedTracksCount: likedCount,
    profile: profileRow,
  });
};

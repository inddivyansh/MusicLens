/**
 * server/routes/profile/liked.js
 * GET /api/profile/liked
 * Returns the authenticated user's manually liked MusicLens catalog tracks.
 */

'use strict';

const { validateSession } = require('../../lib/session');
const { getDb } = require('../../lib/db');
const { sendJson } = require('../../lib/validate');

module.exports = async function getLiked(req, res) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }

  if (!process.env.DATABASE_URL) {
    return sendJson(res, 500, { error: 'Server configuration error.' });
  }

  let session;
  try {
    session = await validateSession(req);
  } catch (err) {
    console.error('[profile/liked] session error:', err.message);
    return sendJson(res, 500, { error: 'Server error.' });
  }
  if (!session) return sendJson(res, 401, { error: 'Not authenticated.' });

  const sql = getDb();

  let tracks;
  try {
    tracks = await sql`
      SELECT
        t.track_id,
        t.track_name,
        a.artist_name,
        STRING_AGG(DISTINCT g.genre_name, ', ' ORDER BY g.genre_name) AS genre_name,
        t.track_popularity,
        af.danceability, af.energy, af.valence, af.tempo,
        af.loudness, af.speechiness, af.acousticness,
        af.instrumentalness, af.liveness,
        ult.liked_at
      FROM user_liked_tracks ult
      JOIN tracks t            ON t.track_id  = ult.catalog_track_id
      JOIN artists a           ON a.artist_id = t.artist_id
      JOIN audio_features af   ON af.track_id = t.track_id
      LEFT JOIN playlist_tracks pt ON pt.track_id = t.track_id
      LEFT JOIN genres g       ON g.genre_id  = pt.genre_id
      WHERE ult.user_id = ${session.userId}
      GROUP BY t.track_id, t.track_name, a.artist_name, t.track_popularity,
               af.danceability, af.energy, af.valence, af.tempo,
               af.loudness, af.speechiness, af.acousticness,
               af.instrumentalness, af.liveness, ult.liked_at
      ORDER BY ult.liked_at DESC
      LIMIT 200
    `;
  } catch (err) {
    console.error('[profile/liked] DB error:', err.message);
    return sendJson(res, 500, { error: 'Server error.' });
  }

  return sendJson(res, 200, { tracks: tracks || [] });
};

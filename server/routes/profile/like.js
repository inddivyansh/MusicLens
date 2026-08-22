/**
 * server/routes/profile/like.js
 * POST   /api/profile/like/:trackId   — like a MusicLens catalog track
 * DELETE /api/profile/like/:trackId   — unlike a MusicLens catalog track
 */

'use strict';

const { validateSession } = require('../../lib/session');
const { getDb } = require('../../lib/db');
const { sendJson } = require('../../lib/validate');

module.exports = async function like(req, res) {
  if (!['POST', 'DELETE'].includes(req.method)) {
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }

  if (!process.env.DATABASE_URL) {
    return sendJson(res, 500, { error: 'Server configuration error.' });
  }

  // ── Auth ───────────────────────────────────────────────────────────────
  let session;
  try {
    session = await validateSession(req);
  } catch (err) {
    console.error('[profile/like] session error:', err.message);
    return sendJson(res, 500, { error: 'Server error.' });
  }
  if (!session) return sendJson(res, 401, { error: 'Not authenticated.' });

  // ── Extract trackId from req.query.trackId or URL path ────────────────
  let trackId = req.query?.trackId;
  if (!trackId && req.url) {
    const urlParts = req.url.split('?')[0].split('/');
    trackId = urlParts[urlParts.length - 1];
  }

  if (!trackId || trackId === 'like') {
    return sendJson(res, 400, { error: 'Missing track ID.' });
  }

  // Basic Spotify Base62 track ID validation (22 chars, alphanumeric)
  if (!/^[A-Za-z0-9]{22}$/.test(trackId)) {
    return sendJson(res, 400, { error: 'Invalid track ID format.' });
  }

  const sql = getDb();

  // ── POST: like ─────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const catalogRows = await sql`
      SELECT track_id FROM tracks WHERE track_id = ${trackId} LIMIT 1
    `.catch(() => []);

    if (catalogRows.length === 0) {
      return sendJson(res, 404, { error: 'Track not found in the MusicLens catalog.' });
    }

    try {
      await sql`
        INSERT INTO user_liked_tracks (user_id, catalog_track_id)
        VALUES (${session.userId}, ${trackId})
        ON CONFLICT (user_id, catalog_track_id) DO NOTHING
      `;
    } catch (err) {
      console.error('[profile/like] insert error:', err.message);
      return sendJson(res, 500, { error: 'Could not like track.' });
    }

    return sendJson(res, 200, { ok: true, liked: true, trackId });
  }

  // ── DELETE: unlike ─────────────────────────────────────────────────────
  try {
    await sql`
      DELETE FROM user_liked_tracks
      WHERE user_id = ${session.userId} AND catalog_track_id = ${trackId}
    `;
  } catch (err) {
    console.error('[profile/like] delete error:', err.message);
    return sendJson(res, 500, { error: 'Could not unlike track.' });
  }

  return sendJson(res, 200, { ok: true, liked: false, trackId });
};

/**
 * GET /api/auth/me
 * Returns the currently authenticated user's public fields.
 *
 * Success: 200 { id, email, spotifyConnected: boolean }
 * Errors:  401 (no/invalid/expired session), 500 (server)
 *
 * spotifyConnected is true iff a spotify_connections row exists for this user.
 * Never returns password_hash, raw token, or Spotify tokens.
 */

'use strict';

const { validateSession } = require('../_lib/session');
const { getDb } = require('../_lib/db');
const { sendJson } = require('../_lib/validate');

module.exports = async function me(req, res) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }

  if (!process.env.DATABASE_URL) {
    return sendJson(res, 500, { error: 'Server configuration error.' });
  }

  // ── Validate session ───────────────────────────────────────────────────
  let session;
  try {
    session = await validateSession(req);
  } catch (err) {
    console.error('[me] Session validation error:', err.message);
    return sendJson(res, 500, { error: 'Server error.' });
  }

  if (!session) {
    return sendJson(res, 401, { error: 'Not authenticated.' });
  }

  const sql = getDb();

  // ── Fetch user + spotify connection status in one query ────────────────
  let userData;
  try {
    const rows = await sql`
      SELECT
        u.id,
        u.email,
        (sc.user_id IS NOT NULL) AS spotify_connected
      FROM users u
      LEFT JOIN spotify_connections sc ON sc.user_id = u.id
      WHERE u.id = ${session.userId}
      LIMIT 1
    `;
    userData = rows[0];
  } catch (err) {
    console.error('[me] DB error:', err.message);
    return sendJson(res, 500, { error: 'Server error.' });
  }

  if (!userData) {
    return sendJson(res, 401, { error: 'Not authenticated.' });
  }

  return sendJson(res, 200, {
    id: userData.id,
    email: userData.email,
    spotifyConnected: Boolean(userData.spotify_connected),
  });
};

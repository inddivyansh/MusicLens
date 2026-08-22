/**
 * server/routes/spotify/status.js
 * GET /api/spotify/status
 * Returns the Spotify connection state for the authenticated user.
 *
 * Success: 200 { connected: boolean, displayName: string|null, scope: string|null }
 * Errors:  401 (not authenticated), 500 (server)
 *
 * Never returns encrypted tokens, raw tokens, or account_id.
 */

'use strict';

const { validateSession } = require('../../lib/session');
const { getDb } = require('../../lib/db');
const { sendJson } = require('../../lib/validate');

module.exports = async function status(req, res) {
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
    console.error('[spotify/status] session error:', err.message);
    return sendJson(res, 500, { error: 'Server error.' });
  }
  if (!session) {
    return sendJson(res, 401, { error: 'Not authenticated.' });
  }

  // ── Query connection — only safe fields ───────────────────────────────
  const sql = getDb();
  let connection;
  try {
    const rows = await sql`
      SELECT display_name, scope
      FROM spotify_connections
      WHERE user_id = ${session.userId}
      LIMIT 1
    `;
    connection = rows[0] || null;
  } catch (err) {
    console.error('[spotify/status] DB error:', err.message);
    return sendJson(res, 500, { error: 'Server error.' });
  }

  if (!connection) {
    return sendJson(res, 200, { connected: false, displayName: null, scope: null });
  }

  return sendJson(res, 200, {
    connected: true,
    displayName: connection.display_name || null,
    scope: connection.scope || null,
  });
};

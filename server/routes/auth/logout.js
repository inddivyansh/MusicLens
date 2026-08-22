/**
 * server/routes/auth/logout.js
 * POST /api/auth/logout
 * Invalidates the current session and clears the session cookie.
 * Idempotent: returns 200 even when no valid session is present.
 *
 * Success: 200 { ok: true } + cleared ml_session cookie
 * Error:   500 only if the DB delete fails while a valid session was present
 */

'use strict';

const {
  getRawTokenFromRequest,
  deleteSession,
  buildClearCookieHeader,
} = require('../../lib/session');
const { sendJson } = require('../../lib/validate');

module.exports = async function logout(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }

  const clearCookie = buildClearCookieHeader();
  const rawToken = getRawTokenFromRequest(req);

  if (!rawToken) {
    // No cookie — idempotent clear
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': clearCookie });
  }

  try {
    await deleteSession(rawToken);
  } catch (err) {
    console.error('[logout] DB error:', err.message);
    // Do NOT clear cookie if delete failed — would leave a dangling DB row
    return sendJson(res, 500, { error: 'Logout failed. Please try again.' });
  }

  return sendJson(res, 200, { ok: true }, { 'Set-Cookie': clearCookie });
};

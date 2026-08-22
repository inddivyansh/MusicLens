/**
 * server/routes/auth/login.js
 * POST /api/auth/login
 * Authenticates an existing MusicLens user.
 *
 * Body: { email: string, password: string }
 * Success: 200 { id, email } + Set-Cookie: ml_session
 * Errors:  422 (validation), 401 (bad credentials), 500 (server)
 *
 * Security: both "wrong email" and "wrong password" return the same 401
 * response to prevent user enumeration.  Passwords are never logged.
 */

'use strict';

const bcrypt = require('bcryptjs');
const { getDb } = require('../../lib/db');
const { createSession } = require('../../lib/session');
const { isValidEmail, sendJson, parseBody } = require('../../lib/validate');

// Generic message for all authentication failures — do not distinguish.
const AUTH_ERROR = { error: 'Invalid email or password.' };

module.exports = async function login(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }

  if (!process.env.DATABASE_URL) {
    return sendJson(res, 500, { error: 'Server configuration error.' });
  }

  // ── Parse + validate ───────────────────────────────────────────────────
  const body = await parseBody(req);
  const { email, password } = body;

  const missing = [];
  if (!email || String(email).trim() === '') missing.push('email');
  if (!password || String(password).trim() === '') missing.push('password');
  if (missing.length > 0) {
    return sendJson(res, 422, { error: 'Missing required fields.', fields: missing });
  }

  if (!isValidEmail(email)) {
    return sendJson(res, 422, { error: 'Invalid email address format.' });
  }

  const normalizedEmail = email.toLowerCase().trim();
  const sql = getDb();

  // ── Fetch user ─────────────────────────────────────────────────────────
  let user;
  try {
    const rows = await sql`
      SELECT id, email, password_hash
      FROM users
      WHERE email = ${normalizedEmail}
      LIMIT 1
    `;
    user = rows[0];
  } catch (err) {
    console.error('[login] DB error:', err.message);
    return sendJson(res, 500, { error: 'Login failed. Please try again.' });
  }

  if (!user) {
    // Constant-time bcrypt to prevent timing attacks revealing email existence
    await bcrypt.compare(password, '$2b$12$invalidhashpaddingtoconstanttime000000000000000000000000');
    return sendJson(res, 401, AUTH_ERROR);
  }

  // ── Verify password — never log password ──────────────────────────────
  const passwordMatch = await bcrypt.compare(password, user.password_hash);
  if (!passwordMatch) {
    return sendJson(res, 401, AUTH_ERROR);
  }

  // ── Create session ─────────────────────────────────────────────────────
  let setCookieHeader;
  try {
    const session = await createSession(user.id, req);
    setCookieHeader = session.cookieHeader || session.setCookieHeader;
  } catch (err) {
    console.error('[login] Session creation error:', err.message);
    return sendJson(res, 500, { error: 'Login failed. Please try again.' });
  }

  // ── Respond — id and email only ───────────────────────────────────────
  return sendJson(
    res,
    200,
    { id: user.id, email: user.email },
    { 'Set-Cookie': setCookieHeader }
  );
};

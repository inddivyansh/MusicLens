/**
 * server/routes/auth/register.js
 * POST /api/auth/register
 * Creates a new MusicLens account.
 *
 * Body: { email: string, password: string }
 * Success: 201 { id, email } + Set-Cookie: ml_session
 * Errors:  422 (validation), 409 (duplicate email), 500 (server)
 */

'use strict';

const bcrypt = require('bcryptjs');
const { getDb } = require('../../lib/db');
const { createSession } = require('../../lib/session');
const { isValidEmail, isValidPassword, sendJson, parseBody } = require('../../lib/validate');

const BCRYPT_COST = 12;

module.exports = async function register(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }

  // ── Env guard ──────────────────────────────────────────────────────────
  if (!process.env.DATABASE_URL) {
    return sendJson(res, 500, { error: 'Server configuration error.' });
  }

  // ── Parse + validate body ──────────────────────────────────────────────
  const body = await parseBody(req);
  const { email, password } = body;

  const missing = [];
  if (!email) missing.push('email');
  if (!password) missing.push('password');
  if (missing.length > 0) {
    return sendJson(res, 422, {
      error: 'Missing required fields.',
      fields: missing,
    });
  }

  if (!isValidEmail(email)) {
    return sendJson(res, 422, { error: 'Invalid email address format.' });
  }

  if (!isValidPassword(password)) {
    return sendJson(res, 422, {
      error: 'Password must be between 8 and 72 characters.',
    });
  }

  const normalizedEmail = email.toLowerCase().trim();

  // ── Hash password — do NOT log password ───────────────────────────────
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

  const sql = getDb();

  // ── Insert user + profile atomically ──────────────────────────────────
  let newUser;
  try {
    const rows = await sql`
      WITH inserted_user AS (
        INSERT INTO users (email, password_hash)
        VALUES (${normalizedEmail}, ${passwordHash})
        RETURNING id, email
      ),
      inserted_profile AS (
        INSERT INTO user_profiles (user_id)
        SELECT id FROM inserted_user
      )
      SELECT id, email FROM inserted_user
    `;
    newUser = rows[0];
  } catch (err) {
    // Unique constraint violation on email
    if (err.code === '23505' || (err.message && err.message.includes('users_email_key'))) {
      return sendJson(res, 409, { error: 'An account with that email already exists.' });
    }
    console.error('[register] DB error:', err.message);
    return sendJson(res, 500, { error: 'Registration failed. Please try again.' });
  }

  // ── Create session ─────────────────────────────────────────────────────
  let setCookieHeader;
  try {
    const session = await createSession(newUser.id, req);
    setCookieHeader = session.cookieHeader || session.setCookieHeader;
  } catch (err) {
    console.error('[register] Session creation error:', err.message);
    return sendJson(res, 500, { error: 'Account created but session could not be initialised.' });
  }

  // ── Respond — never include password_hash ─────────────────────────────
  return sendJson(
    res,
    201,
    { id: newUser.id, email: newUser.email },
    { 'Set-Cookie': setCookieHeader }
  );
};

/**
 * api/_lib/session.js
 * Session middleware for Vercel Serverless Functions.
 *
 * Cookie name: ml_session
 * Attributes:  HttpOnly; Secure; SameSite=Lax; Max-Age=2592000 (30 days)
 *
 * The raw token is placed in the cookie; only its SHA-256 hash is stored in DB.
 * Expired sessions are deleted lazily on read.
 */

'use strict';

const cookie = require('cookie');
const { getDb } = require('./db');
const { hashToken, generateSessionToken } = require('./crypto');

const COOKIE_NAME = 'ml_session';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

// ── Cookie helpers ─────────────────────────────────────────────────────────

function buildSetCookieHeader(rawToken) {
  return cookie.serialize(COOKIE_NAME, rawToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: MAX_AGE_SECONDS,
    path: '/',
  });
}

function buildClearCookieHeader() {
  return cookie.serialize(COOKIE_NAME, '', {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 0,
    expires: new Date(0),
    path: '/',
  });
}

/**
 * Parse the ml_session cookie from the incoming request.
 * @param {object} req  Vercel/Node IncomingMessage
 * @returns {string|null}  raw token or null
 */
function getRawTokenFromRequest(req) {
  const cookieHeader = req.headers && req.headers.cookie;
  if (!cookieHeader) return null;
  const parsed = cookie.parse(cookieHeader);
  return parsed[COOKIE_NAME] || null;
}

// ── Session creation ───────────────────────────────────────────────────────

/**
 * Create a new session in the DB and return the raw token + Set-Cookie header.
 * @param {string} userId  UUID
 * @returns {{ rawToken: string, setCookieHeader: string }}
 */
async function createSession(userId) {
  const sql = getDb();
  const rawToken = generateSessionToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + MAX_AGE_SECONDS * 1000);

  await sql`
    INSERT INTO sessions (user_id, token_hash, expires_at)
    VALUES (${userId}, ${tokenHash}, ${expiresAt})
  `;

  return { rawToken, setCookieHeader: buildSetCookieHeader(rawToken) };
}

// ── Session validation ─────────────────────────────────────────────────────

/**
 * Validate a request's session cookie.
 * - Returns { userId } on success.
 * - Returns null when the cookie is missing, hash not found, or session expired.
 * - Deletes expired rows lazily.
 *
 * @param {object} req  Vercel/Node IncomingMessage
 * @returns {Promise<{ userId: string }|null>}
 */
async function validateSession(req) {
  const rawToken = getRawTokenFromRequest(req);
  if (!rawToken) return null;

  const sql = getDb();
  const tokenHash = hashToken(rawToken);
  const now = new Date();

  const rows = await sql`
    SELECT id, user_id, expires_at
    FROM sessions
    WHERE token_hash = ${tokenHash}
    LIMIT 1
  `;

  if (rows.length === 0) return null;

  const session = rows[0];

  // Expired — delete lazily
  if (new Date(session.expires_at) <= now) {
    await sql`DELETE FROM sessions WHERE id = ${session.id}`.catch(() => {});
    return null;
  }

  // Verify the owning user still exists
  const userRows = await sql`
    SELECT id FROM users WHERE id = ${session.user_id} LIMIT 1
  `;
  if (userRows.length === 0) {
    await sql`DELETE FROM sessions WHERE id = ${session.id}`.catch(() => {});
    return null;
  }

  return { userId: session.user_id };
}

// ── Session deletion ───────────────────────────────────────────────────────

/**
 * Delete a session by its raw token.
 * @param {string} rawToken
 */
async function deleteSession(rawToken) {
  const sql = getDb();
  const tokenHash = hashToken(rawToken);
  await sql`DELETE FROM sessions WHERE token_hash = ${tokenHash}`;
}

module.exports = {
  COOKIE_NAME,
  buildSetCookieHeader,
  buildClearCookieHeader,
  getRawTokenFromRequest,
  createSession,
  validateSession,
  deleteSession,
};

// ── requireAuth helper ─────────────────────────────────────────────────────
// Used to DRY up the auth guard pattern across all protected endpoints.
// Returns { userId } or calls sendJson(res, 401) and returns null.
// Callers must `if (!session) return;` after calling this.
// (Exported as a separate property to avoid circular dep issues with validate.js)
const { sendJson } = require('./validate');

/**
 * Validate session and send 401 if invalid.
 * @param {object} req
 * @param {object} res
 * @param {string} [tag] - optional log tag e.g. '[profile/get]'
 * @returns {Promise<{ userId: string }|null>}
 */
async function requireAuth(req, res, tag = '') {
  try {
    const session = await validateSession(req);
    if (!session) {
      sendJson(res, 401, { error: 'Not authenticated.' });
      return null;
    }
    return session;
  } catch (err) {
    if (tag) console.error(`${tag} session error:`, err.message);
    sendJson(res, 500, { error: 'Server error.' });
    return null;
  }
}

module.exports.requireAuth = requireAuth;

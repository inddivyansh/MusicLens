/**
 * server/routes/spotify/connect.js
 * GET /api/spotify/connect
 * Initiates Spotify OAuth Authorization Code flow.
 *
 * 1. Verifies MusicLens session (must be logged in).
 * 2. Generates a cryptographically random OAuth state (16 bytes).
 * 3. Persists state to oauth_state table (TTL = 10 min).
 * 4. Redirects browser to Spotify authorization URL.
 *
 * SPOTIFY_CLIENT_SECRET is never sent to the browser.
 * Required env: SPOTIFY_CLIENT_ID, SPOTIFY_REDIRECT_URI, DATABASE_URL, TOKEN_ENCRYPTION_KEY
 */

'use strict';

const { validateSession } = require('../../lib/session');
const { generateOAuthState } = require('../../lib/crypto');
const { getDb } = require('../../lib/db');
const { sendJson } = require('../../lib/validate');

const SPOTIFY_SCOPES = [
  'user-read-private',
  'user-read-email',
  'user-top-read',
  'user-read-recently-played',
  'user-library-read',
].join(' ');

const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize';

module.exports = async function connect(req, res) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }

  // ── Env guard ──────────────────────────────────────────────────────────
  const missing = ['DATABASE_URL', 'SPOTIFY_CLIENT_ID', 'SPOTIFY_REDIRECT_URI', 'TOKEN_ENCRYPTION_KEY']
    .filter((k) => !process.env[k]);
  if (missing.length > 0) {
    return sendJson(res, 500, { error: 'Server configuration error.' });
  }

  // ── Auth guard — must be logged in ────────────────────────────────────
  let session;
  try {
    session = await validateSession(req);
  } catch (err) {
    console.error('[spotify/connect] session error:', err.message);
    return sendJson(res, 500, { error: 'Server error.' });
  }
  if (!session) {
    return sendJson(res, 401, { error: 'Not authenticated.' });
  }

  // ── Generate + persist OAuth state ────────────────────────────────────
  const state = generateOAuthState();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  try {
    const sql = getDb();
    // Clean up any old pending states for this user first
    await sql`DELETE FROM oauth_state WHERE user_id = ${session.userId}`;
    await sql`
      INSERT INTO oauth_state (user_id, state, expires_at)
      VALUES (${session.userId}, ${state}, ${expiresAt})
    `;
  } catch (err) {
    console.error('[spotify/connect] DB error:', err.message);
    return sendJson(res, 500, { error: 'Could not initiate Spotify connection.' });
  }

  // ── Build Spotify authorization URL ───────────────────────────────────
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.SPOTIFY_CLIENT_ID,
    scope: SPOTIFY_SCOPES,
    redirect_uri: process.env.SPOTIFY_REDIRECT_URI,
    state,
  });

  const authUrl = `${SPOTIFY_AUTH_URL}?${params.toString()}`;

  res.statusCode = 302;
  res.setHeader('Location', authUrl);
  res.setHeader('Cache-Control', 'no-store');
  res.end();
};

/**
 * server/routes/spotify/disconnect.js
 * POST /api/spotify/disconnect
 * Disconnects a user's Spotify account from MusicLens.
 *
 * 1. Validates MusicLens session.
 * 2. Attempts to revoke the Spotify refresh token (best-effort, 5s timeout).
 * 3. Deletes the spotify_connections row regardless of revocation result.
 * 4. Returns 200 { ok: true } — idempotent.
 *
 * Tokens are never returned or logged.
 * Required env: DATABASE_URL, TOKEN_ENCRYPTION_KEY
 */

'use strict';

const { validateSession } = require('../../lib/session');
const { decrypt } = require('../../lib/crypto');
const { getDb } = require('../../lib/db');
const { sendJson } = require('../../lib/validate');

const REVOKE_URL = 'https://accounts.spotify.com/api/token/revoke';
const REVOKE_TIMEOUT_MS = 5_000;

async function revokeRefreshToken(encryptedRefreshToken) {
  let refreshToken;
  try {
    refreshToken = decrypt(encryptedRefreshToken);
  } catch {
    return;
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return;

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REVOKE_TIMEOUT_MS);
  try {
    await fetch(REVOKE_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ token: refreshToken }).toString(),
    });
  } catch {
    // Timeout or network error — swallow, local delete proceeds
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async function disconnect(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }

  if (!process.env.DATABASE_URL || !process.env.TOKEN_ENCRYPTION_KEY) {
    return sendJson(res, 500, { error: 'Server configuration error.' });
  }

  // ── Auth guard ─────────────────────────────────────────────────────────
  let session;
  try {
    session = await validateSession(req);
  } catch (err) {
    console.error('[spotify/disconnect] session error:', err.message);
    return sendJson(res, 500, { error: 'Server error.' });
  }
  if (!session) {
    return sendJson(res, 401, { error: 'Not authenticated.' });
  }

  const sql = getDb();

  // ── Fetch stored encrypted refresh token before deleting ──────────────
  let encryptedRefresh = null;
  try {
    const rows = await sql`
      SELECT refresh_token_encrypted
      FROM spotify_connections
      WHERE user_id = ${session.userId}
      LIMIT 1
    `;
    if (rows.length > 0) {
      encryptedRefresh = rows[0].refresh_token_encrypted;
    }
  } catch (err) {
    console.error('[spotify/disconnect] fetch token error:', err.message);
  }

  // ── Best-effort Spotify token revocation ──────────────────────────────
  if (encryptedRefresh) {
    await revokeRefreshToken(encryptedRefresh);
  }

  // ── Delete Spotify connection row ─────────────────────────────────────
  try {
    await sql`
      DELETE FROM spotify_connections WHERE user_id = ${session.userId}
    `;
  } catch (err) {
    console.error('[spotify/disconnect] delete error:', err.message);
    return sendJson(res, 500, { error: 'Could not disconnect Spotify. Please try again.' });
  }

  return sendJson(res, 200, { ok: true });
};

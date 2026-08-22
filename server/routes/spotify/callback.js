/**
 * server/routes/spotify/callback.js
 * GET /api/spotify/callback
 * Handles the Spotify OAuth redirect after user authorization.
 *
 * Flow:
 *  1. Validate CSRF state against oauth_state table.
 *  2. Exchange authorization code for tokens (server-to-server, 10s timeout).
 *  3. Call GET /v1/me to retrieve account_id, id, display_name.
 *  4. Guard against account_id already linked to a different MusicLens user.
 *  5. Upsert spotify_connections with AES-256-GCM encrypted tokens.
 *  6. Redirect browser to /?spotify=connected
 *
 * Tokens are NEVER returned to the browser or logged.
 * Required env: SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REDIRECT_URI,
 *               DATABASE_URL, TOKEN_ENCRYPTION_KEY, APP_BASE_URL
 */

'use strict';

const { validateSession } = require('../../lib/session');
const { encrypt } = require('../../lib/crypto');
const { getDb } = require('../../lib/db');
const { sendJson } = require('../../lib/validate');

const TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token';
const ME_ENDPOINT = 'https://api.spotify.com/v1/me';
const FETCH_TIMEOUT_MS = 10_000;

/** Fetch with a hard timeout. */
async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async function callback(req, res) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }

  // ── Env guard ──────────────────────────────────────────────────────────
  const requiredEnv = [
    'DATABASE_URL', 'SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET',
    'SPOTIFY_REDIRECT_URI', 'TOKEN_ENCRYPTION_KEY', 'APP_BASE_URL',
  ];
  if (requiredEnv.some((k) => !process.env[k])) {
    return sendJson(res, 500, { error: 'Server configuration error.' });
  }

  // ── Parse query params ─────────────────────────────────────────────────
  const urlObj = new URL(req.url, `https://${req.headers?.host || 'localhost'}`);
  const code = req.query?.code || urlObj.searchParams.get('code');
  const state = req.query?.state || urlObj.searchParams.get('state');
  const errorParam = req.query?.error || urlObj.searchParams.get('error');

  // ── User denied authorization ──────────────────────────────────────────
  if (errorParam) {
    return sendJson(res, 400, { error: 'Spotify authorization was denied by the user.' });
  }

  if (!state) {
    return sendJson(res, 400, { error: 'Missing OAuth state parameter.' });
  }

  // ── Validate CSRF state against DB ────────────────────────────────────
  const sql = getDb();
  let stateRow;
  try {
    const rows = await sql`
      SELECT user_id, expires_at
      FROM oauth_state
      WHERE state = ${state}
      LIMIT 1
    `;
    stateRow = rows[0];
  } catch (err) {
    console.error('[spotify/callback] state lookup error:', err.message);
    return sendJson(res, 500, { error: 'Server error during state validation.' });
  }

  if (!stateRow) {
    return sendJson(res, 400, { error: 'Invalid or expired OAuth state.' });
  }

  if (new Date(stateRow.expires_at) <= new Date()) {
    await sql`DELETE FROM oauth_state WHERE state = ${state}`.catch(() => {});
    return sendJson(res, 400, { error: 'OAuth state has expired. Please try connecting again.' });
  }

  // Delete the used state immediately (one-time use)
  await sql`DELETE FROM oauth_state WHERE state = ${state}`.catch(() => {});

  const userId = stateRow.user_id;

  if (!code) {
    return sendJson(res, 400, { error: 'Missing authorization code.' });
  }

  // ── Exchange code for tokens ───────────────────────────────────────────
  const credentials = Buffer.from(
    `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
  ).toString('base64');

  let tokenData;
  try {
    const tokenRes = await fetchWithTimeout(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.SPOTIFY_REDIRECT_URI,
      }).toString(),
    });

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text().catch(() => '');
      console.error('[spotify/callback] token exchange failed:', tokenRes.status, errBody);
      return sendJson(res, 502, { error: 'Spotify token exchange failed.' });
    }

    tokenData = await tokenRes.json();
  } catch (err) {
    if (err.name === 'AbortError') {
      return sendJson(res, 502, { error: 'Spotify token exchange timed out.' });
    }
    console.error('[spotify/callback] token exchange error:', err.message);
    return sendJson(res, 502, { error: 'Spotify token exchange failed.' });
  }

  // Never log tokens — only validate their presence
  if (!tokenData.access_token || !tokenData.refresh_token) {
    return sendJson(res, 502, { error: 'Spotify returned incomplete token data.' });
  }

  // ── Fetch Spotify user profile ─────────────────────────────────────────
  let spotifyProfile;
  try {
    const meRes = await fetchWithTimeout(ME_ENDPOINT, {
      headers: { 'Authorization': `Bearer ${tokenData.access_token}` },
    });

    if (!meRes.ok) {
      console.error('[spotify/callback] /me failed:', meRes.status);
      return sendJson(res, 502, { error: 'Could not retrieve Spotify profile.' });
    }

    spotifyProfile = await meRes.json();
  } catch (err) {
    if (err.name === 'AbortError') {
      return sendJson(res, 502, { error: 'Spotify profile retrieval timed out.' });
    }
    console.error('[spotify/callback] /me error:', err.message);
    return sendJson(res, 502, { error: 'Could not retrieve Spotify profile.' });
  }

  // Spotify's immutable account identifier — use this for linking, not .id
  const accountId = spotifyProfile.account_id || spotifyProfile.id;
  const spotifyUserId = spotifyProfile.id;
  const displayName = spotifyProfile.display_name || null;

  if (!accountId) {
    return sendJson(res, 502, { error: 'Spotify did not return a valid account identifier.' });
  }

  // ── Guard: account_id already linked to a DIFFERENT user ─────────────
  try {
    const existing = await sql`
      SELECT user_id FROM spotify_connections
      WHERE account_id = ${accountId}
      LIMIT 1
    `;
    if (existing.length > 0 && existing[0].user_id !== userId) {
      return sendJson(res, 409, {
        error: 'This Spotify account is already linked to a different MusicLens account.',
      });
    }
  } catch (err) {
    console.error('[spotify/callback] conflict check error:', err.message);
    return sendJson(res, 500, { error: 'Server error.' });
  }

  // ── Encrypt tokens before storage — never store plaintext ─────────────
  let encryptedAccess, encryptedRefresh;
  try {
    encryptedAccess = encrypt(tokenData.access_token);
    encryptedRefresh = encrypt(tokenData.refresh_token);
  } catch (err) {
    console.error('[spotify/callback] encryption error:', err.message);
    return sendJson(res, 500, { error: 'Server configuration error.' });
  }

  const accessExpiresAt = new Date(Date.now() + (tokenData.expires_in || 3600) * 1000);
  const scope = tokenData.scope || '';

  // ── Upsert spotify_connections ─────────────────────────────────────────
  try {
    await sql`
      INSERT INTO spotify_connections (
        user_id, account_id, spotify_user_id, display_name, scope,
        refresh_token_encrypted, access_token_encrypted, access_token_expires_at,
        connected_at, updated_at
      )
      VALUES (
        ${userId}, ${accountId}, ${spotifyUserId}, ${displayName}, ${scope},
        ${encryptedRefresh}, ${encryptedAccess}, ${accessExpiresAt},
        NOW(), NOW()
      )
      ON CONFLICT (user_id) DO UPDATE SET
        account_id               = EXCLUDED.account_id,
        spotify_user_id          = EXCLUDED.spotify_user_id,
        display_name             = EXCLUDED.display_name,
        scope                    = EXCLUDED.scope,
        refresh_token_encrypted  = EXCLUDED.refresh_token_encrypted,
        access_token_encrypted   = EXCLUDED.access_token_encrypted,
        access_token_expires_at  = EXCLUDED.access_token_expires_at,
        updated_at               = NOW()
    `;
  } catch (err) {
    console.error('[spotify/callback] upsert error:', err.message);
    return sendJson(res, 500, { error: 'Could not save Spotify connection.' });
  }

  // ── Redirect to frontend with success indicator ────────────────────────
  const baseUrl = process.env.APP_BASE_URL || '';
  res.statusCode = 302;
  res.setHeader('Location', `${baseUrl}/?spotify=connected`);
  res.setHeader('Cache-Control', 'no-store');
  res.end();
};

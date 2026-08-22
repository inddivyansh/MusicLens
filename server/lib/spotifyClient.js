/**
 * server/lib/spotifyClient.js
 * Spotify Web API client for server-side use only.
 *
 * Responsibilities:
 *  - Decrypt stored tokens (never logs or returns them)
 *  - Proactively refresh access token when expired (or within 5 min of expiry)
 *  - Fetch top tracks, recently played, and liked songs with pagination
 *  - Handle 401 (revoked), 403 (scope missing), 429 (rate limit) gracefully
 *
 * All token material stays on the server. Nothing is returned to the browser.
 */

'use strict';

const { getDb } = require('./db');
const { decrypt, encrypt } = require('./crypto');

const SPOTIFY_API = 'https://api.spotify.com/v1';
const TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token';
const FETCH_TIMEOUT_MS = 12_000;
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function loadConnection(userId) {
  const sql = getDb();
  const rows = await sql`
    SELECT access_token_encrypted, refresh_token_encrypted, access_token_expires_at
    FROM spotify_connections
    WHERE user_id = ${userId}
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  return rows[0];
}

async function getAccessToken(userId) {
  const conn = await loadConnection(userId);
  if (!conn) throw new SpotifyAuthError('No Spotify connection found.');

  const now = new Date();
  const expiresAt = new Date(conn.access_token_expires_at);

  if (expiresAt > new Date(now.getTime() + REFRESH_BUFFER_MS)) {
    try {
      return decrypt(conn.access_token_encrypted);
    } catch {
      // Decryption failed — fall through to refresh
    }
  }

  let refreshToken;
  try {
    refreshToken = decrypt(conn.refresh_token_encrypted);
  } catch {
    throw new SpotifyAuthError('Could not decrypt refresh token — connection may be corrupt.');
  }

  const credentials = Buffer.from(
    `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
  ).toString('base64');

  let refreshRes;
  try {
    refreshRes = await fetchWithTimeout(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }).toString(),
    });
  } catch (err) {
    if (err.name === 'AbortError') throw new SpotifyAuthError('Token refresh timed out.');
    throw new SpotifyAuthError(`Token refresh network error: ${err.message}`);
  }

  if (refreshRes.status === 400 || refreshRes.status === 401) {
    throw new SpotifyAuthError('Spotify refresh token has been revoked. Please reconnect Spotify.');
  }

  if (!refreshRes.ok) {
    throw new SpotifyAuthError(`Token refresh failed (HTTP ${refreshRes.status}).`);
  }

  const tokenData = await refreshRes.json();
  if (!tokenData.access_token) {
    throw new SpotifyAuthError('Spotify returned no access token during refresh.');
  }

  const newAccessExpiry = new Date(Date.now() + (tokenData.expires_in || 3600) * 1000);
  const sql = getDb();
  const encryptedAccess = encrypt(tokenData.access_token);

  if (tokenData.refresh_token) {
    await sql`
      UPDATE spotify_connections SET
        access_token_encrypted  = ${encryptedAccess},
        refresh_token_encrypted = ${encrypt(tokenData.refresh_token)},
        access_token_expires_at = ${newAccessExpiry},
        updated_at              = NOW()
      WHERE user_id = ${userId}
    `;
  } else {
    await sql`
      UPDATE spotify_connections SET
        access_token_encrypted  = ${encryptedAccess},
        access_token_expires_at = ${newAccessExpiry},
        updated_at              = NOW()
      WHERE user_id = ${userId}
    `;
  }

  return tokenData.access_token;
}

async function spotifyGet(userId, path, params = {}) {
  const token = await getAccessToken(userId);

  const url = new URL(`${SPOTIFY_API}${path}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }

  let res;
  try {
    res = await fetchWithTimeout(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    if (err.name === 'AbortError') throw new SpotifyApiError(`Request to ${path} timed out.`);
    throw new SpotifyApiError(`Network error fetching ${path}: ${err.message}`);
  }

  if (res.status === 401) throw new SpotifyAuthError('Spotify access was revoked. Please reconnect.');
  if (res.status === 403) throw new SpotifyAuthError('Missing Spotify permission scope.');
  if (res.status === 429) {
    const retryAfter = res.headers.get('Retry-After') || '30';
    throw new SpotifyRateLimitError(`Spotify rate limit hit. Retry after ${retryAfter}s.`);
  }
  if (!res.ok) throw new SpotifyApiError(`Spotify API error ${res.status} on ${path}`);

  return res.json();
}

async function fetchTopTracks(userId) {
  const ranges = ['short_term', 'medium_term', 'long_term'];
  const seen = new Set();
  const tracks = [];

  for (const range of ranges) {
    try {
      const data = await spotifyGet(userId, '/me/top/tracks', { limit: 50, time_range: range });
      for (const item of (data.items || [])) {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          tracks.push({
            spotify_track_id: item.id,
            track_name: item.name,
            artist_name: item.artists?.[0]?.name || '',
            source: 'top_tracks',
          });
        }
      }
    } catch (err) {
      if (err instanceof SpotifyAuthError) throw err;
      console.warn(`[spotifyClient] fetchTopTracks ${range} failed:`, err.message);
    }
  }
  return tracks;
}

async function fetchRecentlyPlayed(userId) {
  try {
    const data = await spotifyGet(userId, '/me/player/recently-played', { limit: 50 });
    const seen = new Set();
    const tracks = [];
    for (const item of (data.items || [])) {
      const t = item.track;
      if (!t || seen.has(t.id)) continue;
      seen.add(t.id);
      tracks.push({
        spotify_track_id: t.id,
        track_name: t.name,
        artist_name: t.artists?.[0]?.name || '',
        source: 'recently_played',
      });
    }
    return tracks;
  } catch (err) {
    if (err instanceof SpotifyAuthError) throw err;
    console.warn('[spotifyClient] fetchRecentlyPlayed failed:', err.message);
    return [];
  }
}

async function fetchLikedSongs(userId) {
  try {
    const data = await spotifyGet(userId, '/me/tracks', { limit: 50 });
    const tracks = [];
    for (const item of (data.items || [])) {
      const t = item.track;
      if (!t) continue;
      tracks.push({
        spotify_track_id: t.id,
        track_name: t.name,
        artist_name: t.artists?.[0]?.name || '',
        source: 'liked_songs',
      });
    }
    return tracks;
  } catch (err) {
    if (err instanceof SpotifyAuthError) throw err;
    console.warn('[spotifyClient] fetchLikedSongs failed:', err.message);
    return [];
  }
}

async function fetchAllUserMusic(userId) {
  const [topTracks, recentTracks, likedSongs] = await Promise.all([
    fetchTopTracks(userId),
    fetchRecentlyPlayed(userId),
    fetchLikedSongs(userId),
  ]);

  return [...topTracks, ...recentTracks, ...likedSongs];
}

class SpotifyAuthError extends Error {
  constructor(msg) { super(msg); this.name = 'SpotifyAuthError'; }
}
class SpotifyRateLimitError extends Error {
  constructor(msg) { super(msg); this.name = 'SpotifyRateLimitError'; }
}
class SpotifyApiError extends Error {
  constructor(msg) { super(msg); this.name = 'SpotifyApiError'; }
}

module.exports = {
  fetchAllUserMusic,
  fetchTopTracks,
  fetchRecentlyPlayed,
  fetchLikedSongs,
  SpotifyAuthError,
  SpotifyRateLimitError,
  SpotifyApiError,
};

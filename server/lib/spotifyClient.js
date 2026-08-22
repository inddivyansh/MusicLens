/**
 * server/lib/spotifyClient.js
 * Spotify Web API client — production-quality ingestion with pagination,
 * source metadata preservation, stable-ID deduplication, and rate-limit handling.
 *
 * Design principles:
 *  - Each source (top_tracks, recently_played, liked_songs) is fetched and
 *    returned separately with full metadata. Callers receive distinct arrays;
 *    merging/weighting decisions belong to the profile layer, not here.
 *  - Deduplication within each source uses the Spotify Base62 track ID.
 *    A track may validly appear in multiple sources — that is intentional and
 *    preserved so the taste profile can weight sources correctly.
 *  - Timestamps (played_at, added_at) and position/frequency metadata are
 *    preserved so the Phase 1 temporal-decay layer has what it needs.
 *  - Pagination is implemented for recently_played and liked_songs. Top tracks
 *    is already exhausted by fetching all three time-range buckets × 50.
 *  - Rate-limit responses (HTTP 429) are respected: the Retry-After header
 *    is read and propagated; no automatic back-off loop (serverless budget).
 *  - All token handling is unchanged from the existing implementation.
 */

'use strict';

const { getDb } = require('./db');
const { decrypt, encrypt } = require('./crypto');

const SPOTIFY_API = 'https://api.spotify.com/v1';
const TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token';
const FETCH_TIMEOUT_MS = 12_000;
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Pagination config — conservative defaults for a serverless environment.
// Each page is a separate HTTP round-trip; stay well under Vercel's 10s limit.
// ---------------------------------------------------------------------------
const PAGINATION_DEFAULTS = Object.freeze({
  // recently_played: Spotify max 50 per page; cursor-based (before/after).
  // 3 pages × 50 = 150 items captures ~1-2 weeks of typical listening.
  recently_played_max_pages: 3,
  recently_played_page_size: 50,

  // liked_songs: offset-based pagination, Spotify max 50 per page.
  // 4 pages × 50 = 200 items; enough for a meaningful profile without
  // spending excessive time or hitting secondary rate limits.
  liked_songs_max_pages: 4,
  liked_songs_page_size: 50,

  // top_tracks: no pagination needed — fetch all 3 time-range buckets × 50.
  top_tracks_limit: 50,
});

// ---------------------------------------------------------------------------
// Core HTTP helpers
// ---------------------------------------------------------------------------

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
      // Decryption failure — fall through to refresh.
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
        Authorization: `Basic ${credentials}`,
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

/**
 * Authenticated GET against the Spotify API. Builds URL, attaches Bearer token,
 * handles 401 / 403 / 429 as typed errors. Does not retry (serverless budget).
 */
async function spotifyGet(userId, path, params = {}) {
  const token = await getAccessToken(userId);

  const url = new URL(`${SPOTIFY_API}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
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
    throw new SpotifyRateLimitError(`Spotify rate limit hit. Retry after ${retryAfter}s.`, Number(retryAfter));
  }
  if (!res.ok) throw new SpotifyApiError(`Spotify API error ${res.status} on ${path}`);

  return res.json();
}

// ---------------------------------------------------------------------------
// Source: Top Tracks  (3 time-range buckets, no cursor pagination)
// ---------------------------------------------------------------------------

/**
 * Fetch top tracks across all three Spotify time ranges.
 *
 * Returns one entry per unique Spotify track ID. The time-range with the
 * highest position (earliest rank) wins when a track appears in multiple
 * ranges — the position and time_range of the first occurrence are stored.
 *
 * @param {string} userId
 * @param {{ top_tracks_limit?: number }} [opts]
 * @returns {Promise<TopTrack[]>}
 *
 * @typedef {Object} TopTrack
 * @property {string}  spotify_track_id
 * @property {string}  track_name
 * @property {string}  artist_name
 * @property {string[]} all_artist_names
 * @property {string}  album_name
 * @property {string|null} album_id
 * @property {number|null} duration_ms
 * @property {number}  popularity        — Spotify track popularity 0-100
 * @property {'top_tracks'} source
 * @property {string}  time_range        — short_term|medium_term|long_term
 * @property {number}  position          — 1-indexed rank within that range
 * @property {string}  fetched_at        — ISO timestamp of this fetch
 * @property {number}  interaction_count — always 1 for top tracks
 */
async function fetchTopTracks(userId, opts = {}) {
  const limit = opts.top_tracks_limit ?? PAGINATION_DEFAULTS.top_tracks_limit;
  const ranges = ['short_term', 'medium_term', 'long_term'];
  const fetchedAt = new Date().toISOString();

  // seen map: track_id → TopTrack (first/best occurrence wins)
  const seen = new Map();

  for (const range of ranges) {
    try {
      const data = await spotifyGet(userId, '/me/top/tracks', { limit, time_range: range });
      for (const [idx, item] of (data.items || []).entries()) {
        if (!item?.id) continue;
        if (!seen.has(item.id)) {
          seen.set(item.id, {
            spotify_track_id: item.id,
            track_name: item.name || '',
            artist_name: item.artists?.[0]?.name || '',
            all_artist_names: (item.artists || []).map((a) => a.name).filter(Boolean),
            album_name: item.album?.name || '',
            album_id: item.album?.id || null,
            duration_ms: item.duration_ms ?? null,
            popularity: item.popularity ?? 0,
            source: 'top_tracks',
            time_range: range,
            position: idx + 1,
            fetched_at: fetchedAt,
            interaction_count: 1,
          });
        }
      }
    } catch (err) {
      if (err instanceof SpotifyAuthError) throw err;
      if (err instanceof SpotifyRateLimitError) throw err;
      console.warn(`[spotifyClient] fetchTopTracks(${range}) failed:`, err.message);
    }
  }

  return [...seen.values()];
}

// ---------------------------------------------------------------------------
// Source: Recently Played  (cursor-based pagination)
// ---------------------------------------------------------------------------

/**
 * Fetch recently played tracks with cursor-based pagination.
 *
 * Spotify exposes up to 50 items per page, using `before` (Unix ms timestamp)
 * as the cursor to walk backwards through history. We fetch pages until we
 * either hit max_pages or run out of history.
 *
 * Deduplication within this source: the same track_id can appear multiple
 * times (separate listens). We aggregate by track_id:
 *  - most_recent_played_at  = earliest played_at in the batch (most recent time)
 *  - interaction_count      = total number of plays in the batch
 *
 * This gives the temporal-decay layer a real signal while not inflating the
 * track count when calculating source-group profiles.
 *
 * @param {string} userId
 * @param {{ recently_played_max_pages?: number, recently_played_page_size?: number }} [opts]
 * @returns {Promise<RecentTrack[]>}
 *
 * @typedef {Object} RecentTrack
 * @property {string}  spotify_track_id
 * @property {string}  track_name
 * @property {string}  artist_name
 * @property {string[]} all_artist_names
 * @property {string}  album_name
 * @property {string|null} album_id
 * @property {number|null} duration_ms
 * @property {number}  popularity
 * @property {'recently_played'} source
 * @property {string}  played_at         — ISO timestamp of most-recent play in batch
 * @property {number}  interaction_count — number of plays observed across paginated batch
 * @property {string}  fetched_at
 */
async function fetchRecentlyPlayed(userId, opts = {}) {
  const maxPages = opts.recently_played_max_pages ?? PAGINATION_DEFAULTS.recently_played_max_pages;
  const pageSize = opts.recently_played_page_size ?? PAGINATION_DEFAULTS.recently_played_page_size;
  const fetchedAt = new Date().toISOString();

  // Aggregate map: track_id → { track data, play timestamps[] }
  const byTrackId = new Map();
  let cursor = undefined; // `before` param (Unix ms timestamp string)
  let pagesLoaded = 0;

  while (pagesLoaded < maxPages) {
    let data;
    const params = { limit: pageSize };
    if (cursor !== undefined) params.before = cursor;

    try {
      data = await spotifyGet(userId, '/me/player/recently-played', params);
    } catch (err) {
      if (err instanceof SpotifyAuthError) throw err;
      if (err instanceof SpotifyRateLimitError) throw err;
      console.warn('[spotifyClient] fetchRecentlyPlayed page error:', err.message);
      break;
    }

    const items = data.items || [];
    if (items.length === 0) break;

    for (const item of items) {
      const t = item.track;
      if (!t?.id) continue;
      const playedAt = item.played_at || null;

      const existing = byTrackId.get(t.id);
      if (existing) {
        existing.interaction_count += 1;
        // Keep the most-recent played_at (chronologically latest)
        if (playedAt && existing.played_at && playedAt > existing.played_at) {
          existing.played_at = playedAt;
        }
        existing._all_played_at.push(playedAt);
      } else {
        byTrackId.set(t.id, {
          spotify_track_id: t.id,
          track_name: t.name || '',
          artist_name: t.artists?.[0]?.name || '',
          all_artist_names: (t.artists || []).map((a) => a.name).filter(Boolean),
          album_name: t.album?.name || '',
          album_id: t.album?.id || null,
          duration_ms: t.duration_ms ?? null,
          popularity: t.popularity ?? 0,
          source: 'recently_played',
          played_at: playedAt,
          interaction_count: 1,
          fetched_at: fetchedAt,
          _all_played_at: [playedAt],
        });
      }
    }

    pagesLoaded++;

    // Advance cursor: use the `before` value from the next cursor in Spotify's response,
    // falling back to the played_at of the last item converted to Unix ms.
    const nextCursor = data.cursors?.before ?? data.next_cursor ?? null;
    if (nextCursor) {
      cursor = nextCursor;
    } else if (items.length > 0) {
      const lastPlayedAt = items[items.length - 1].played_at;
      if (lastPlayedAt) {
        cursor = String(new Date(lastPlayedAt).getTime());
      } else {
        break; // No cursor available — stop pagination.
      }
    } else {
      break;
    }

    // Terminate if next page URL is absent (end of history)
    if (!data.next) break;
  }

  // Strip internal aggregation field before returning
  return [...byTrackId.values()].map(({ _all_played_at, ...track }) => track);
}

// ---------------------------------------------------------------------------
// Source: Liked / Saved Songs  (offset-based pagination)
// ---------------------------------------------------------------------------

/**
 * Fetch saved/liked tracks with offset-based pagination.
 *
 * A track can only be saved once, so no intra-source deduplication is needed.
 * added_at (ISO timestamp of when the user saved the track) is preserved for
 * the temporal profile layer.
 *
 * @param {string} userId
 * @param {{ liked_songs_max_pages?: number, liked_songs_page_size?: number }} [opts]
 * @returns {Promise<LikedTrack[]>}
 *
 * @typedef {Object} LikedTrack
 * @property {string}  spotify_track_id
 * @property {string}  track_name
 * @property {string}  artist_name
 * @property {string[]} all_artist_names
 * @property {string}  album_name
 * @property {string|null} album_id
 * @property {number|null} duration_ms
 * @property {number}  popularity
 * @property {'liked_songs'} source
 * @property {string|null} added_at      — ISO timestamp of save
 * @property {number}  interaction_count — always 1 (saved once)
 * @property {string}  fetched_at
 */
async function fetchLikedSongs(userId, opts = {}) {
  const maxPages = opts.liked_songs_max_pages ?? PAGINATION_DEFAULTS.liked_songs_max_pages;
  const pageSize = opts.liked_songs_page_size ?? PAGINATION_DEFAULTS.liked_songs_page_size;
  const fetchedAt = new Date().toISOString();

  const tracks = [];
  const seen = new Set(); // guard against API duplicates across pages
  let offset = 0;
  let pagesLoaded = 0;

  while (pagesLoaded < maxPages) {
    let data;
    try {
      data = await spotifyGet(userId, '/me/tracks', { limit: pageSize, offset });
    } catch (err) {
      if (err instanceof SpotifyAuthError) throw err;
      if (err instanceof SpotifyRateLimitError) throw err;
      console.warn('[spotifyClient] fetchLikedSongs page error:', err.message);
      break;
    }

    const items = data.items || [];
    if (items.length === 0) break;

    for (const item of items) {
      const t = item.track;
      if (!t?.id || seen.has(t.id)) continue;
      seen.add(t.id);
      tracks.push({
        spotify_track_id: t.id,
        track_name: t.name || '',
        artist_name: t.artists?.[0]?.name || '',
        all_artist_names: (t.artists || []).map((a) => a.name).filter(Boolean),
        album_name: t.album?.name || '',
        album_id: t.album?.id || null,
        duration_ms: t.duration_ms ?? null,
        popularity: t.popularity ?? 0,
        source: 'liked_songs',
        added_at: item.added_at || null,
        interaction_count: 1,
        fetched_at: fetchedAt,
      });
    }

    pagesLoaded++;
    offset += items.length;

    // Stop if Spotify signals no more pages
    if (!data.next || items.length < pageSize) break;
  }

  return tracks;
}

// ---------------------------------------------------------------------------
// Source: Top Artists (no pagination, used for genre inference)
// ---------------------------------------------------------------------------

/**
 * Fetch top artists for genre inference. Not paginated — 50 items is
 * sufficient to classify the user's genre profile.
 *
 * @param {string} userId
 * @returns {Promise<Array>}
 */
async function fetchTopArtists(userId) {
  try {
    const data = await spotifyGet(userId, '/me/top/artists', {
      limit: 50,
      time_range: 'medium_term',
    });
    return (data.items || []).map((item) => ({
      spotify_artist_id: item.id,
      artist_name: item.name || '',
      genres: item.genres || [],
      popularity: item.popularity ?? 0,
    }));
  } catch (err) {
    if (err instanceof SpotifyAuthError) throw err;
    if (err instanceof SpotifyRateLimitError) throw err;
    console.warn('[spotifyClient] fetchTopArtists failed:', err.message);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Orchestrator: fetch all sources in parallel
// ---------------------------------------------------------------------------

/**
 * Fetch all user music data from Spotify in parallel.
 *
 * Returns sources as SEPARATE arrays. The caller is responsible for
 * deduplication-across-sources logic (which must preserve source identity
 * for profile weighting). This function only deduplicates within each source.
 *
 * @param {string} userId
 * @param {object} [paginationOpts] — override PAGINATION_DEFAULTS per source
 * @returns {Promise<SpotifyIngestionResult>}
 *
 * @typedef {Object} SpotifyIngestionResult
 * @property {TopTrack[]}    topTracks       — deduped by track_id within source
 * @property {RecentTrack[]} recentTracks    — deduped + interaction_count aggregated
 * @property {LikedTrack[]}  likedSongs      — one entry per saved track
 * @property {Array}         topArtists      — for genre inference
 * @property {string[]}      tracks          — flat union for legacy callers
 *                                             (same object references, not copies)
 * @property {object}        ingestionStats  — per-source counts and pagination info
 */
async function fetchAllUserMusic(userId, paginationOpts = {}) {
  const [topTracks, recentTracks, likedSongs, topArtists] = await Promise.all([
    fetchTopTracks(userId, paginationOpts),
    fetchRecentlyPlayed(userId, paginationOpts),
    fetchLikedSongs(userId, paginationOpts),
    fetchTopArtists(userId),
  ]);

  // Flat union for backward-compatibility with callers that iterate `tracks`.
  // Each item retains its `.source` property so downstream can still distinguish.
  const tracks = [...topTracks, ...recentTracks, ...likedSongs];

  const ingestionStats = {
    top_tracks_count: topTracks.length,
    recently_played_count: recentTracks.length,
    liked_songs_count: likedSongs.length,
    total_raw: tracks.length,
    // Cross-source unique track count (same ID in multiple sources counts once)
    unique_spotify_ids: new Set(tracks.map((t) => t.spotify_track_id)).size,
  };

  return { topTracks, recentTracks, likedSongs, topArtists, tracks, ingestionStats };
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

class SpotifyAuthError extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'SpotifyAuthError';
  }
}

class SpotifyRateLimitError extends Error {
  constructor(msg, retryAfterSeconds = 30) {
    super(msg);
    this.name = 'SpotifyRateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

class SpotifyApiError extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'SpotifyApiError';
  }
}

module.exports = {
  fetchAllUserMusic,
  fetchTopTracks,
  fetchRecentlyPlayed,
  fetchLikedSongs,
  fetchTopArtists,
  PAGINATION_DEFAULTS,
  SpotifyAuthError,
  SpotifyRateLimitError,
  SpotifyApiError,
};

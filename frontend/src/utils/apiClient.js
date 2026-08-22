/**
 * frontend/src/utils/apiClient.js
 * Thin fetch wrapper for MusicLens API endpoints.
 *
 * - Always sends credentials: 'include' so the httpOnly session cookie travels with every request.
 * - Never reads, stores, or exposes session tokens, Spotify tokens, or DATABASE_URL.
 * - Throws ApiError on non-2xx responses with the server's JSON error message.
 */

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request(method, path, body) {
  const options = {
    method,
    credentials: 'include',           // sends httpOnly cookie automatically
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  const res = await fetch(path, options);

  // Try to parse JSON; fall back to a generic message
  let data;
  try {
    data = await res.json();
  } catch {
    data = { error: `Server returned ${res.status}` };
  }

  if (!res.ok) {
    throw new ApiError(data.error || `Request failed (${res.status})`, res.status);
  }
  return data;
}

// ── Auth ───────────────────────────────────────────────────────────────────
export const authApi = {
  register: (email, password) => request('POST', '/api/auth/register', { email, password }),
  login:    (email, password) => request('POST', '/api/auth/login',    { email, password }),
  logout:   ()                => request('POST', '/api/auth/logout'),
  me:       ()                => request('GET',  '/api/auth/me'),
};

// ── Spotify ────────────────────────────────────────────────────────────────
export const spotifyApi = {
  /** Returns { connected, displayName, scope } */
  status:     () => request('GET',  '/api/spotify/status'),
  /** Deletes the Spotify connection server-side */
  disconnect: () => request('POST', '/api/spotify/disconnect'),
  /** Redirect URL — browser navigates here directly (triggers server redirect to Spotify) */
  connectUrl: '/api/spotify/connect',
};

// ── Profile ────────────────────────────────────────────────────────────────
export const profileApi = {
  /** GET /api/profile — returns persisted profile without calling Spotify */
  get: () => request('GET', '/api/profile'),

  /** POST /api/profile/refresh — full Spotify sync + recalculate */
  refresh: () => request('POST', '/api/profile/refresh'),

  /** GET /api/profile/liked — returns manually liked catalog tracks */
  getLiked: () => request('GET', '/api/profile/liked'),

  /** POST /api/profile/like/:trackId — like a catalog track */
  like: (trackId) => request('POST', `/api/profile/like/${trackId}`),

  /** DELETE /api/profile/like/:trackId — unlike a catalog track */
  unlike: (trackId) => request('DELETE', `/api/profile/like/${trackId}`),
};

// ── Recommendations ────────────────────────────────────────────────────────
export const recommendationsApi = {
  /**
   * GET /api/recommendations
   * @param {{ limit?, genre?, minPopularity?, mode?, excludeSeedArtists?, save? }} opts
   */
  get: (opts = {}) => {
    const params = new URLSearchParams();
    if (opts.limit)         params.set('limit',         String(opts.limit));
    if (opts.genre)         params.set('genre',         opts.genre);
    if (opts.minPopularity) params.set('minPopularity', String(opts.minPopularity));
    if (opts.mode)          params.set('mode',          opts.mode);
    if (opts.excludeSeedArtists) params.set('excludeSeedArtists', 'true');
    if (opts.save)          params.set('save',          'true');
    const qs = params.toString();
    return request('GET', `/api/recommendations${qs ? '?' + qs : ''}`);
  },
};

// ── Recap ──────────────────────────────────────────────────────────────────
export const recapApi = {
  /** GET /api/recap — returns recap from persisted profile (no Spotify call) */
  get: () => request('GET', '/api/recap'),
};

// ── Analytics (public — no auth required) ─────────────────────────────────
export const analyticsApi = {
  /** GET /api/analytics/overview — KPIs, genre distribution, decade evolution */
  overview: () => request('GET', '/api/analytics/overview'),

  /** GET /api/analytics/genres — genre×subgenre audio profiles */
  genres: () => request('GET', '/api/analytics/genres'),

  /** GET /api/analytics/artists — artist leaderboard */
  artists: (limit = 50) => request('GET', `/api/analytics/artists?limit=${limit}`),

  /** GET /api/analytics/audio — feature stats + mood distribution */
  audio: () => request('GET', '/api/analytics/audio'),
};

// ── Friend Blend ───────────────────────────────────────────────────────────
export const blendApi = {
  /** POST /api/blend — create a new blend invitation */
  create: () => request('POST', '/api/blend'),

  /** GET /api/blend — list user's blend sessions */
  list: () => request('GET', '/api/blend'),

  /** POST /api/blend/join — accept a blend invitation */
  join: (token) => request('POST', '/api/blend/join', { token }),

  /** GET /api/blend/:id — get blend status and results */
  get: (blendId) => request('GET', `/api/blend/${blendId}`),
};

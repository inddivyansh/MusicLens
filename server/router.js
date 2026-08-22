/**
 * server/router.js
 * Central API router for MusicLens.
 * Dispatches incoming requests to the appropriate modular route handler.
 */

'use strict';

const { sendJson } = require('./lib/validate');

// Route handlers
const handleAuthRegister   = require('./routes/auth/register');
const handleAuthLogin      = require('./routes/auth/login');
const handleAuthLogout     = require('./routes/auth/logout');
const handleAuthMe         = require('./routes/auth/me');

const handleSpotifyConnect    = require('./routes/spotify/connect');
const handleSpotifyCallback   = require('./routes/spotify/callback');
const handleSpotifyStatus     = require('./routes/spotify/status');
const handleSpotifyDisconnect = require('./routes/spotify/disconnect');

const handleProfileGet     = require('./routes/profile/index');
const handleProfileRefresh = require('./routes/profile/refresh');
const handleProfileLiked   = require('./routes/profile/liked');
const handleProfileLike    = require('./routes/profile/like');

const handleRecommendations = require('./routes/recommendations/index');
const handleRecap           = require('./routes/recap/index');

const handleBlendIndex  = require('./routes/blend/index');
const handleBlendJoin   = require('./routes/blend/join');
const handleBlendDetail = require('./routes/blend/detail');

const handleAnalyticsOverview = require('./routes/analytics/overview');
const handleAnalyticsGenres   = require('./routes/analytics/genres');
const handleAnalyticsAudio    = require('./routes/analytics/audio');
const handleAnalyticsArtists  = require('./routes/analytics/artists');

/**
 * Extract clean pathname from request URL or Vercel query path.
 * @param {object} req
 * @returns {string} Normalized path starting with '/' (e.g. '/auth/login', '/profile/like/xyz')
 */
function getNormalizedPathname(req) {
  let rawPath = '';

  // If Vercel passed path segments in req.query.path
  if (req.query && req.query.path) {
    if (Array.isArray(req.query.path)) {
      rawPath = '/' + req.query.path.join('/');
    } else if (typeof req.query.path === 'string') {
      rawPath = '/' + req.query.path;
    }
  }

  // Fallback / standard extraction from req.url
  if (!rawPath && req.url) {
    rawPath = req.url.split('?')[0];
  }

  // Normalize: strip leading /api if present
  let normalized = rawPath.replace(/^\/api(\/|$)/, '/');
  if (!normalized.startsWith('/')) {
    normalized = '/' + normalized;
  }
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

/**
 * Populate req.query with search params from req.url if missing.
 * @param {object} req
 */
function populateQueryParams(req) {
  req.query = req.query || {};
  if (req.url && req.url.includes('?')) {
    try {
      const urlObj = new URL(req.url, 'http://localhost');
      for (const [k, v] of urlObj.searchParams.entries()) {
        if (req.query[k] === undefined) {
          req.query[k] = v;
        }
      }
    } catch {
      // Ignore parse errors
    }
  }
}

/**
 * Main dispatcher function.
 * @param {object} req
 * @param {object} res
 */
async function dispatch(req, res) {
  populateQueryParams(req);

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cookie');
    return res.end();
  }

  const pathname = getNormalizedPathname(req);

  // ── Auth routes ─────────────────────────────────────────────────────────
  if (pathname === '/auth/register') {
    return handleAuthRegister(req, res);
  }
  if (pathname === '/auth/login') {
    return handleAuthLogin(req, res);
  }
  if (pathname === '/auth/logout') {
    return handleAuthLogout(req, res);
  }
  if (pathname === '/auth/me') {
    return handleAuthMe(req, res);
  }

  // ── Spotify routes ──────────────────────────────────────────────────────
  if (pathname === '/spotify/connect') {
    return handleSpotifyConnect(req, res);
  }
  if (pathname === '/spotify/callback') {
    return handleSpotifyCallback(req, res);
  }
  if (pathname === '/spotify/status') {
    return handleSpotifyStatus(req, res);
  }
  if (pathname === '/spotify/disconnect') {
    return handleSpotifyDisconnect(req, res);
  }

  // ── Profile routes ──────────────────────────────────────────────────────
  if (pathname === '/profile') {
    return handleProfileGet(req, res);
  }
  if (pathname === '/profile/refresh') {
    return handleProfileRefresh(req, res);
  }
  if (pathname === '/profile/liked') {
    return handleProfileLiked(req, res);
  }

  // Dynamic route: /profile/like/:trackId
  const profileLikeMatch = pathname.match(/^\/profile\/like\/([^/]+)$/);
  if (profileLikeMatch) {
    req.query.trackId = profileLikeMatch[1];
    return handleProfileLike(req, res);
  }

  // ── Recommendations route ───────────────────────────────────────────────
  if (pathname === '/recommendations') {
    return handleRecommendations(req, res);
  }

  // ── Recap route ─────────────────────────────────────────────────────────
  if (pathname === '/recap') {
    return handleRecap(req, res);
  }

  // ── Blend routes ────────────────────────────────────────────────────────
  if (pathname === '/blend') {
    return handleBlendIndex(req, res);
  }
  if (pathname === '/blend/join') {
    return handleBlendJoin(req, res);
  }

  // Dynamic route: /blend/:id (where :id is not 'join')
  const blendDetailMatch = pathname.match(/^\/blend\/([^/]+)$/);
  if (blendDetailMatch && blendDetailMatch[1] !== 'join') {
    req.query.id = blendDetailMatch[1];
    return handleBlendDetail(req, res);
  }

  // ── Analytics routes ────────────────────────────────────────────────────
  if (pathname === '/analytics/overview') {
    return handleAnalyticsOverview(req, res);
  }
  if (pathname === '/analytics/genres') {
    return handleAnalyticsGenres(req, res);
  }
  if (pathname === '/analytics/audio') {
    return handleAnalyticsAudio(req, res);
  }
  if (pathname === '/analytics/artists') {
    return handleAnalyticsArtists(req, res);
  }

  // ── Unknown route: 404 ──────────────────────────────────────────────────
  return sendJson(res, 404, { error: `API route not found: ${pathname}` });
}

module.exports = dispatch;
module.exports.getNormalizedPathname = getNormalizedPathname;

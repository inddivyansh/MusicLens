/**
 * GET /api/recommendations
 * Returns personalized MusicLens recommendations based on the user's persisted
 * preference_vector (from POST /api/profile/refresh) blended with manual likes.
 *
 * Query params:
 *   limit         number  1–50  (default 20)
 *   genre         string        filter by genre name (optional)
 *   minPopularity number  0–100 (default 0)
 *   save          boolean       if "true", writes a recommendation_history row
 *
 * Response:
 *   { recommendations: [...], stats: {...}, noProfileReason?: string }
 *
 * Does NOT call Spotify. The full computation is against the MusicLens catalog.
 * Security: scoped to session.userId — user A cannot get user B's recommendations.
 */

'use strict';

const { validateSession } = require('../_lib/session');
const { getDb } = require('../_lib/db');
const { sendJson } = require('../_lib/validate');
const { generateRecommendations } = require('../_lib/recommender');

module.exports = async function recommendations(req, res) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }

  if (!process.env.DATABASE_URL) {
    return sendJson(res, 500, { error: 'Server configuration error.' });
  }

  // ── Auth guard ─────────────────────────────────────────────────────────
  let session;
  try {
    session = await validateSession(req);
  } catch (err) {
    console.error('[recommendations] session error:', err.message);
    return sendJson(res, 500, { error: 'Server error.' });
  }
  if (!session) return sendJson(res, 401, { error: 'Not authenticated.' });

  // ── Parse + sanitize query params ─────────────────────────────────────
  const urlObj = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  const limitRaw   = urlObj.searchParams.get('limit')         || '20';
  const genreRaw   = urlObj.searchParams.get('genre')         || '';
  const minPopRaw  = urlObj.searchParams.get('minPopularity') || '0';
  const save       = urlObj.searchParams.get('save') === 'true';

  // Clamp numerics; strip genre to alphanumeric+& to prevent injection attempts
  const limit         = Math.min(50, Math.max(1,  parseInt(limitRaw)  || 20));
  const minPopularity = Math.min(90, Math.max(0,  parseInt(minPopRaw) || 0));
  const genre         = genreRaw ? genreRaw.replace(/[^a-zA-Z0-9& ]/g, '').slice(0, 30).trim() || null : null;

  let result;
  try {
    result = await generateRecommendations(session.userId, {
      limit,
      genre,
      minPopularity,
    });
  } catch (err) {
    console.error('[recommendations] engine error:', err.message);
    return sendJson(res, 500, { error: 'Recommendation engine failed.' });
  }

  // ── Optionally persist to recommendation_history ───────────────────────
  if (save && result.recommendations.length > 0) {
    try {
      const sql = getDb();
      const trackIds = result.recommendations.map((r) => r.track_id);
      const scores   = result.recommendations.map((r) => r.similarity_score);
      await sql`
        INSERT INTO recommendation_history (user_id, track_ids, similarity_scores, filters_used)
        VALUES (
          ${session.userId},
          ${JSON.stringify(trackIds)},
          ${JSON.stringify(scores)},
          ${JSON.stringify({ genre: genre || null, min_popularity: minPopularity, limit })}
        )
      `;
    } catch (err) {
      console.warn('[recommendations] history write failed:', err.message);
    }
  }

  return sendJson(res, 200, result);
};

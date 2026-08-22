/**
 * server/routes/analytics/audio.js
 * GET /api/analytics/audio
 * Catalog-wide audio feature statistics and distributions from PostgreSQL.
 * Public endpoint. Returns feature min/mean/max/stddev + mood distribution.
 * 5-minute server-side cache.
 */

'use strict';

const { getDb } = require('../../lib/db');
const { sendJson } = require('../../lib/validate');

let _cache = null;
let _cacheExpiry = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

module.exports = async function analyticsAudio(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed.' });
  if (!process.env.DATABASE_URL) return sendJson(res, 500, { error: 'Server configuration error.' });

  if (_cache && Date.now() < _cacheExpiry) return sendJson(res, 200, _cache);

  let sql;
  try { sql = getDb(); } catch {
    return sendJson(res, 500, { error: 'Database unavailable.' });
  }

  try {
    const [statsRows, moodRows] = await Promise.all([
      sql`
        SELECT
          'danceability'    AS feature, MIN(danceability)    AS min, MAX(danceability)    AS max,
          ROUND(AVG(danceability)::NUMERIC,3)    AS mean, ROUND(STDDEV(danceability)::NUMERIC,3) AS stddev
          FROM audio_features
        UNION ALL SELECT 'energy',       MIN(energy),       MAX(energy),
          ROUND(AVG(energy)::NUMERIC,3),       ROUND(STDDEV(energy)::NUMERIC,3)       FROM audio_features
        UNION ALL SELECT 'loudness',     MIN(loudness),     MAX(loudness),
          ROUND(AVG(loudness)::NUMERIC,2),     ROUND(STDDEV(loudness)::NUMERIC,2)     FROM audio_features
        UNION ALL SELECT 'speechiness',  MIN(speechiness),  MAX(speechiness),
          ROUND(AVG(speechiness)::NUMERIC,3),  ROUND(STDDEV(speechiness)::NUMERIC,3)  FROM audio_features
        UNION ALL SELECT 'acousticness', MIN(acousticness), MAX(acousticness),
          ROUND(AVG(acousticness)::NUMERIC,3), ROUND(STDDEV(acousticness)::NUMERIC,3) FROM audio_features
        UNION ALL SELECT 'instrumentalness',MIN(instrumentalness),MAX(instrumentalness),
          ROUND(AVG(instrumentalness)::NUMERIC,3),ROUND(STDDEV(instrumentalness)::NUMERIC,3) FROM audio_features
        UNION ALL SELECT 'liveness',     MIN(liveness),     MAX(liveness),
          ROUND(AVG(liveness)::NUMERIC,3),     ROUND(STDDEV(liveness)::NUMERIC,3)     FROM audio_features
        UNION ALL SELECT 'valence',      MIN(valence),      MAX(valence),
          ROUND(AVG(valence)::NUMERIC,3),      ROUND(STDDEV(valence)::NUMERIC,3)      FROM audio_features
        UNION ALL SELECT 'tempo',        MIN(tempo),        MAX(tempo),
          ROUND(AVG(tempo)::NUMERIC,1),        ROUND(STDDEV(tempo)::NUMERIC,1)        FROM audio_features
      `,
      sql`
        SELECT
          CASE
            WHEN energy >= 0.5 AND valence >= 0.5 THEN 'Upbeat / Euphoric'
            WHEN energy <  0.5 AND valence >= 0.5 THEN 'Chill / Peaceful'
            WHEN energy >= 0.5 AND valence <  0.5 THEN 'Intense / Aggressive'
            ELSE                                       'Melancholic / Sad'
          END                                                           AS mood_quadrant,
          COUNT(*)                                                      AS track_count,
          ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER ()::NUMERIC, 1) AS pct
        FROM audio_features
        GROUP BY mood_quadrant
        ORDER BY track_count DESC
      `,
    ]);

    const featureStats = {};
    for (const r of statsRows) {
      featureStats[r.feature] = {
        min:    Number(r.min),
        max:    Number(r.max),
        mean:   Number(r.mean),
        stddev: Number(r.stddev),
      };
    }

    const result = {
      source: 'database',
      generatedAt: new Date().toISOString(),
      featureStats,
      moodDistribution: moodRows.map((r) => ({
        mood:        r.mood_quadrant,
        track_count: Number(r.track_count),
        pct:         Number(r.pct),
      })),
    };

    _cache = result;
    _cacheExpiry = Date.now() + CACHE_TTL_MS;
    return sendJson(res, 200, result);
  } catch (err) {
    console.error('[analytics/audio] DB error:', err.message);
    return sendJson(res, 500, { error: 'Analytics query failed.' });
  }
};

/**
 * GET /api/analytics/artists
 * Artist performance leaderboard from the PostgreSQL warehouse.
 * Public endpoint. Returns top artists by average popularity (min 3 tracks).
 *
 * Query params:
 *   limit   number 1–100 (default 50)
 *
 * 5-minute server-side cache (keyed by limit).
 */
'use strict';

const { getDb } = require('../_lib/db');
const { sendJson } = require('../_lib/validate');

const _caches = new Map(); // limit → { data, expiry }
const CACHE_TTL_MS = 5 * 60 * 1000;

module.exports = async function analyticsArtists(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed.' });
  if (!process.env.DATABASE_URL) return sendJson(res, 500, { error: 'Server configuration error.' });

  const urlObj = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  const limit = Math.min(100, Math.max(1, parseInt(urlObj.searchParams.get('limit') || '50')));

  const cached = _caches.get(limit);
  if (cached && Date.now() < cached.expiry) return sendJson(res, 200, cached.data);

  let sql;
  try { sql = getDb(); } catch {
    return sendJson(res, 500, { error: 'Database unavailable.' });
  }

  try {
    const rows = await sql`
      SELECT
        a.artist_name                                               AS artist,
        COUNT(t.track_id)                                          AS track_count,
        ROUND(AVG(t.track_popularity)::NUMERIC, 1)                AS avg_popularity,
        MAX(t.track_popularity)                                    AS max_popularity,
        MIN(t.track_popularity)                                    AS min_popularity,
        ROUND(STDDEV(t.track_popularity)::NUMERIC, 1)             AS stddev_popularity,
        ROUND(AVG(af.danceability)::NUMERIC, 3)                   AS avg_danceability,
        ROUND(AVG(af.energy)::NUMERIC, 3)                         AS avg_energy,
        ROUND(AVG(af.valence)::NUMERIC, 3)                        AS avg_valence
      FROM tracks t
      JOIN artists        a  ON a.artist_id  = t.artist_id
      JOIN audio_features af ON af.track_id  = t.track_id
      GROUP BY a.artist_name
      HAVING COUNT(t.track_id) >= 3
      ORDER BY avg_popularity DESC
      LIMIT ${limit}
    `;

    const result = {
      source: 'database',
      generatedAt: new Date().toISOString(),
      limit,
      top_artists: rows.map((r) => ({
        artist:           r.artist,
        track_count:      Number(r.track_count),
        avg_popularity:   Number(r.avg_popularity),
        max_popularity:   Number(r.max_popularity),
        min_popularity:   Number(r.min_popularity),
        stddev_popularity:Number(r.stddev_popularity),
        avg_danceability: Number(r.avg_danceability),
        avg_energy:       Number(r.avg_energy),
        avg_valence:      Number(r.avg_valence),
      })),
    };

    _caches.set(limit, { data: result, expiry: Date.now() + CACHE_TTL_MS });
    return sendJson(res, 200, result);
  } catch (err) {
    console.error('[analytics/artists] DB error:', err.message);
    return sendJson(res, 500, { error: 'Analytics query failed.' });
  }
};

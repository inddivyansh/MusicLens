/**
 * server/routes/analytics/genres.js
 * GET /api/analytics/genres
 * Full genre × subgenre audio profile from the PostgreSQL warehouse.
 * Public endpoint. Returns aggregated genre statistics only.
 * 5-minute server-side cache.
 */

'use strict';

const { getDb } = require('../../lib/db');
const { sendJson } = require('../../lib/validate');

let _cache = null;
let _cacheExpiry = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

module.exports = async function analyticsGenres(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed.' });
  if (!process.env.DATABASE_URL) return sendJson(res, 500, { error: 'Server configuration error.' });

  if (_cache && Date.now() < _cacheExpiry) return sendJson(res, 200, _cache);

  let sql;
  try { sql = getDb(); } catch {
    return sendJson(res, 500, { error: 'Database unavailable.' });
  }

  try {
    const rows = await sql`
      SELECT
        g.genre_name,
        g.subgenre_name,
        COUNT(DISTINCT pt.track_id)                             AS track_count,
        ROUND(AVG(t.track_popularity)::NUMERIC, 2)            AS avg_popularity,
        ROUND((AVG(af.danceability)    * 100)::NUMERIC, 1)    AS avg_danceability_pct,
        ROUND((AVG(af.energy)          * 100)::NUMERIC, 1)    AS avg_energy_pct,
        ROUND(AVG(af.loudness)::NUMERIC, 2)                   AS avg_loudness_db,
        ROUND((AVG(af.speechiness)     * 100)::NUMERIC, 1)    AS avg_speechiness_pct,
        ROUND((AVG(af.acousticness)    * 100)::NUMERIC, 1)    AS avg_acousticness_pct,
        ROUND((AVG(af.instrumentalness)* 100)::NUMERIC, 1)    AS avg_instrumentalness_pct,
        ROUND((AVG(af.liveness)        * 100)::NUMERIC, 1)    AS avg_liveness_pct,
        ROUND((AVG(af.valence)         * 100)::NUMERIC, 1)    AS avg_valence_pct,
        ROUND(AVG(af.tempo)::NUMERIC, 1)                      AS avg_tempo_bpm
      FROM playlist_tracks pt
      JOIN genres           g  ON g.genre_id  = pt.genre_id
      JOIN tracks           t  ON t.track_id  = pt.track_id
      JOIN audio_features   af ON af.track_id = t.track_id
      GROUP BY g.genre_name, g.subgenre_name
      ORDER BY g.genre_name, track_count DESC
    `;

    const result = {
      source: 'database',
      generatedAt: new Date().toISOString(),
      genreProfiles: rows.map((r) => ({
        genre:                  r.genre_name,
        subgenre:               r.subgenre_name,
        track_count:            Number(r.track_count),
        avg_popularity:         Number(r.avg_popularity),
        avg_danceability_pct:   Number(r.avg_danceability_pct),
        avg_energy_pct:         Number(r.avg_energy_pct),
        avg_loudness_db:        Number(r.avg_loudness_db),
        avg_speechiness_pct:    Number(r.avg_speechiness_pct),
        avg_acousticness_pct:   Number(r.avg_acousticness_pct),
        avg_instrumentalness_pct: Number(r.avg_instrumentalness_pct),
        avg_liveness_pct:       Number(r.avg_liveness_pct),
        avg_valence_pct:        Number(r.avg_valence_pct),
        avg_tempo_bpm:          Number(r.avg_tempo_bpm),
      })),
    };

    _cache = result;
    _cacheExpiry = Date.now() + CACHE_TTL_MS;
    return sendJson(res, 200, result);
  } catch (err) {
    console.error('[analytics/genres] DB error:', err.message);
    return sendJson(res, 500, { error: 'Analytics query failed.' });
  }
};

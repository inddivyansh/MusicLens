/**
 * GET /api/analytics/overview
 * Returns KPI summary metrics from the MusicLens PostgreSQL warehouse.
 *
 * Public endpoint — no authentication required.
 * Returns only aggregated statistics, never raw track data or user data.
 *
 * Response shape matches the existing dashboard_bundle.json kpis + genres
 * fields so OverviewTab.jsx can consume either source transparently.
 */
'use strict';

const { getDb } = require('../_lib/db');
const { sendJson } = require('../_lib/validate');

// 5-minute server-side cache to avoid hitting DB on every page load
let _cache = null;
let _cacheExpiry = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

module.exports = async function analyticsOverview(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed.' });

  if (!process.env.DATABASE_URL) return sendJson(res, 500, { error: 'Server configuration error.' });

  // Return cached response if still fresh
  if (_cache && Date.now() < _cacheExpiry) {
    return sendJson(res, 200, _cache);
  }

  let sql;
  try { sql = getDb(); } catch {
    return sendJson(res, 500, { error: 'Database unavailable.' });
  }

  try {
    const [kpiRows, genreRows, decadeRows] = await Promise.all([
      // KPIs
      sql`
        SELECT
          COUNT(DISTINCT t.track_id)                                         AS total_unique_tracks,
          COUNT(DISTINCT t.artist_id)                                        AS total_unique_artists,
          COUNT(DISTINCT g.genre_name)                                       AS total_macro_genres,
          COUNT(DISTINCT g.subgenre_name)                                    AS total_subgenres,
          ROUND(AVG(t.track_popularity)::NUMERIC, 1)                        AS catalog_avg_popularity,
          ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP
            (ORDER BY t.track_popularity)::NUMERIC, 1)                      AS catalog_median_popularity,
          ROUND((AVG(af.energy)    * 100)::NUMERIC, 1)                      AS catalog_avg_energy_pct,
          ROUND((AVG(af.danceability) * 100)::NUMERIC, 1)                   AS catalog_avg_danceability_pct,
          ROUND(AVG(af.tempo)::NUMERIC, 1)                                  AS catalog_avg_tempo_bpm
        FROM tracks t
        JOIN audio_features af  ON af.track_id  = t.track_id
        LEFT JOIN playlist_tracks pt ON pt.track_id = t.track_id
        LEFT JOIN genres g       ON g.genre_id  = pt.genre_id
      `,
      // Genre distribution (matches existing dashboard_bundle genres shape)
      sql`
        SELECT
          g.genre_name                                                  AS genre,
          COUNT(DISTINCT pt.track_id)                                   AS unique_tracks,
          ROUND((COUNT(DISTINCT pt.track_id) * 100.0
            / SUM(COUNT(DISTINCT pt.track_id)) OVER ())::NUMERIC, 1)  AS pct_of_catalog,
          ROUND(AVG(t.track_popularity)::NUMERIC, 2)                  AS avg_popularity,
          ROUND((AVG(t.track_popularity)
            - 1.96 * STDDEV(t.track_popularity)
            / NULLIF(SQRT(COUNT(*)),0))::NUMERIC, 1)                  AS ci_95_lower,
          ROUND((AVG(t.track_popularity)
            + 1.96 * STDDEV(t.track_popularity)
            / NULLIF(SQRT(COUNT(*)),0))::NUMERIC, 1)                  AS ci_95_upper
        FROM playlist_tracks pt
        JOIN genres   g  ON g.genre_id  = pt.genre_id
        JOIN tracks   t  ON t.track_id  = pt.track_id
        GROUP BY g.genre_name
        ORDER BY unique_tracks DESC
      `,
      // Decade evolution
      sql`
        SELECT
          al.release_decade,
          COUNT(DISTINCT t.track_id)                    AS track_count,
          ROUND(AVG(t.track_popularity)::NUMERIC, 2)   AS avg_popularity,
          ROUND((AVG(af.danceability)*100)::NUMERIC,1) AS avg_danceability_pct,
          ROUND((AVG(af.energy)*100)::NUMERIC,1)       AS avg_energy_pct
        FROM tracks t
        JOIN albums         al ON al.album_id  = t.album_id
        JOIN audio_features af ON af.track_id  = t.track_id
        WHERE al.release_decade IS NOT NULL
        GROUP BY al.release_decade
        ORDER BY al.release_decade
      `,
    ]);

    const kpi = kpiRows[0] || {};
    const result = {
      source: 'database',
      generatedAt: new Date().toISOString(),
      kpis: {
        total_unique_tracks:           Number(kpi.total_unique_tracks)       || 0,
        total_unique_artists:          Number(kpi.total_unique_artists)      || 0,
        total_macro_genres:            Number(kpi.total_macro_genres)        || 0,
        total_subgenres:               Number(kpi.total_subgenres)           || 0,
        catalog_avg_popularity:        Number(kpi.catalog_avg_popularity)    || 0,
        catalog_median_popularity:     Number(kpi.catalog_median_popularity) || 0,
        catalog_avg_energy_pct:        Number(kpi.catalog_avg_energy_pct)    || 0,
        catalog_avg_danceability_pct:  Number(kpi.catalog_avg_danceability_pct) || 0,
        catalog_avg_tempo_bpm:         Number(kpi.catalog_avg_tempo_bpm)     || 0,
      },
      genres: genreRows.map((g) => ({
        genre:          g.genre,
        unique_tracks:  Number(g.unique_tracks),
        pct_of_catalog: Number(g.pct_of_catalog),
        avg_popularity: Number(g.avg_popularity),
        ci_95_lower:    Number(g.ci_95_lower),
        ci_95_upper:    Number(g.ci_95_upper),
      })),
      decade_evolution: decadeRows.map((d) => ({
        decade:               d.release_decade,
        track_count:          Number(d.track_count),
        avg_popularity:       Number(d.avg_popularity),
        avg_danceability_pct: Number(d.avg_danceability_pct),
        avg_energy_pct:       Number(d.avg_energy_pct),
      })),
    };

    // Cache for 5 minutes
    _cache = result;
    _cacheExpiry = Date.now() + CACHE_TTL_MS;

    return sendJson(res, 200, result);
  } catch (err) {
    console.error('[analytics/overview] DB error:', err.message);
    return sendJson(res, 500, { error: 'Analytics query failed.' });
  }
};

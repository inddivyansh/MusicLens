-- ============================================================
-- MusicLens — Analytical SQL Queries
-- ============================================================
-- All queries are based on actual dataset characteristics.
-- Dataset: 28,352 unique tracks, 10,692 artists, 6 genres,
--          24 subgenres, release years 1957-2020.
-- ============================================================


-- ============================================================
-- SECTION 1: BASIC AGGREGATIONS
-- ============================================================

-- Q1: Total unique tracks in the catalog
-- Expected: 28,352
SELECT COUNT(*) AS total_tracks
FROM tracks;

-- Q2: Total unique artists
-- Expected: 10,692
SELECT COUNT(*) AS total_artists
FROM artists;

-- Q3: Total unique genres and subgenres
SELECT
    COUNT(DISTINCT genre_name)    AS total_macro_genres,    -- Expected: 6
    COUNT(DISTINCT subgenre_name) AS total_subgenres,       -- Expected: 24
    COUNT(*)                      AS total_genre_subgenre_combos
FROM genres;

-- Q4: Tracks by genre — count and percentage share
SELECT
    g.genre_name,
    COUNT(DISTINCT pt.track_id)                                          AS unique_tracks,
    COUNT(*)                                                             AS playlist_appearances,
    ROUND(COUNT(DISTINCT pt.track_id) * 100.0 / SUM(COUNT(DISTINCT pt.track_id)) OVER (), 2) AS pct_of_catalog
FROM playlist_tracks pt
JOIN genres g ON pt.genre_id = g.genre_id
GROUP BY g.genre_name
ORDER BY unique_tracks DESC;

-- Q5: Average popularity by genre with confidence interval approximation
SELECT
    g.genre_name,
    COUNT(DISTINCT pt.track_id)                                     AS track_count,
    ROUND(AVG(t.track_popularity)::NUMERIC, 2)                     AS avg_popularity,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY t.track_popularity) AS median_popularity,
    ROUND(STDDEV(t.track_popularity)::NUMERIC, 2)                  AS std_popularity,
    -- 95% CI: mean ± 1.96 * (std / sqrt(n))
    ROUND((AVG(t.track_popularity) - 1.96 * STDDEV(t.track_popularity) / SQRT(COUNT(*)))::NUMERIC, 2) AS ci_lower_95,
    ROUND((AVG(t.track_popularity) + 1.96 * STDDEV(t.track_popularity) / SQRT(COUNT(*)))::NUMERIC, 2) AS ci_upper_95
FROM playlist_tracks pt
JOIN genres g ON pt.genre_id   = g.genre_id
JOIN tracks t ON pt.track_id   = t.track_id
GROUP BY g.genre_name
ORDER BY avg_popularity DESC;


-- ============================================================
-- SECTION 2: ARTIST ANALYTICS
-- ============================================================

-- Q6: Top 20 artists by average popularity (min 5 tracks to avoid single-hit bias)
SELECT
    a.artist_name,
    COUNT(*)                                        AS track_count,
    ROUND(AVG(t.track_popularity)::NUMERIC, 1)     AS avg_popularity,
    MAX(t.track_popularity)                         AS peak_popularity,
    ROUND(STDDEV(t.track_popularity)::NUMERIC, 1)  AS popularity_consistency
FROM tracks t
JOIN artists a ON t.artist_id = a.artist_id
GROUP BY a.artist_name
HAVING COUNT(*) >= 5
ORDER BY avg_popularity DESC
LIMIT 20;

-- Q7: Top 20 artists by track count (most prolific in catalog)
SELECT
    a.artist_name,
    COUNT(*)                                       AS track_count,
    ROUND(AVG(t.track_popularity)::NUMERIC, 1)    AS avg_popularity,
    ROUND(AVG(af.danceability)::NUMERIC, 3)       AS avg_danceability,
    ROUND(AVG(af.energy)::NUMERIC, 3)             AS avg_energy
FROM tracks t
JOIN artists        a  ON t.artist_id = a.artist_id
JOIN audio_features af ON t.track_id  = af.track_id
GROUP BY a.artist_name
ORDER BY track_count DESC
LIMIT 20;

-- Q16: Full artist-level summary statistics
SELECT
    a.artist_name,
    COUNT(t.track_id)                                    AS track_count,
    ROUND(AVG(t.track_popularity)::NUMERIC, 1)          AS avg_popularity,
    MAX(t.track_popularity)                              AS max_popularity,
    MIN(t.track_popularity)                              AS min_popularity,
    ROUND(STDDEV(t.track_popularity)::NUMERIC, 1)       AS std_popularity,
    ROUND(AVG(af.danceability)::NUMERIC, 3)             AS avg_danceability,
    ROUND(AVG(af.energy)::NUMERIC, 3)                   AS avg_energy,
    ROUND(AVG(af.valence)::NUMERIC, 3)                  AS avg_valence,
    ROUND(AVG(af.tempo)::NUMERIC, 1)                    AS avg_tempo_bpm,
    COUNT(DISTINCT t.album_id)                          AS album_count,
    MIN(al.release_year)                                AS earliest_release_year,
    MAX(al.release_year)                                AS latest_release_year
FROM tracks t
JOIN artists         a  ON t.artist_id = a.artist_id
JOIN audio_features  af ON t.track_id  = af.track_id
LEFT JOIN albums     al ON t.album_id  = al.album_id
GROUP BY a.artist_name
ORDER BY avg_popularity DESC;


-- ============================================================
-- SECTION 3: AUDIO FEATURE RANKINGS
-- ============================================================

-- Q8: Highest-energy genres (mean + distribution diagnostic)
SELECT
    g.genre_name,
    ROUND(AVG(af.energy)::NUMERIC, 3)                              AS avg_energy,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY af.energy)         AS median_energy,
    ROUND(STDDEV(af.energy)::NUMERIC, 3)                           AS std_energy,
    ROUND(PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY af.energy)::NUMERIC, 3) AS p25_energy,
    ROUND(PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY af.energy)::NUMERIC, 3) AS p75_energy
FROM playlist_tracks pt
JOIN genres         g  ON pt.genre_id = g.genre_id
JOIN tracks         t  ON pt.track_id = t.track_id
JOIN audio_features af ON t.track_id  = af.track_id
GROUP BY g.genre_name
ORDER BY avg_energy DESC;

-- Q9: Most danceable genres
SELECT
    g.genre_name,
    ROUND(AVG(af.danceability)::NUMERIC, 3)                            AS avg_danceability,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY af.danceability)       AS median_danceability,
    ROUND(STDDEV(af.danceability)::NUMERIC, 3)                         AS std_danceability,
    COUNT(DISTINCT pt.track_id)                                        AS track_count
FROM playlist_tracks pt
JOIN genres         g  ON pt.genre_id = g.genre_id
JOIN tracks         t  ON pt.track_id = t.track_id
JOIN audio_features af ON t.track_id  = af.track_id
GROUP BY g.genre_name
ORDER BY avg_danceability DESC;

-- Q10: Highest-valence (happiest) genres
SELECT
    g.genre_name,
    ROUND(AVG(af.valence)::NUMERIC, 3)                             AS avg_valence,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY af.valence)        AS median_valence,
    ROUND(STDDEV(af.valence)::NUMERIC, 3)                          AS std_valence,
    COUNT(DISTINCT pt.track_id)                                    AS track_count
FROM playlist_tracks pt
JOIN genres         g  ON pt.genre_id = g.genre_id
JOIN tracks         t  ON pt.track_id = t.track_id
JOIN audio_features af ON t.track_id  = af.track_id
GROUP BY g.genre_name
ORDER BY avg_valence DESC;

-- Q11: Complete genre-level audio-feature summary matrix
SELECT
    g.genre_name,
    COUNT(DISTINCT pt.track_id)                          AS tracks,
    ROUND(AVG(af.danceability)::NUMERIC, 3)             AS avg_danceability,
    ROUND(AVG(af.energy)::NUMERIC, 3)                   AS avg_energy,
    ROUND(AVG(af.loudness)::NUMERIC, 2)                 AS avg_loudness_db,
    ROUND(AVG(af.speechiness)::NUMERIC, 3)              AS avg_speechiness,
    ROUND(AVG(af.acousticness)::NUMERIC, 3)             AS avg_acousticness,
    ROUND(AVG(af.instrumentalness)::NUMERIC, 3)         AS avg_instrumentalness,
    ROUND(AVG(af.liveness)::NUMERIC, 3)                 AS avg_liveness,
    ROUND(AVG(af.valence)::NUMERIC, 3)                  AS avg_valence,
    ROUND(AVG(af.tempo)::NUMERIC, 1)                    AS avg_tempo_bpm,
    ROUND(AVG(t.track_popularity)::NUMERIC, 2)          AS avg_popularity
FROM playlist_tracks pt
JOIN genres         g  ON pt.genre_id = g.genre_id
JOIN tracks         t  ON pt.track_id = t.track_id
JOIN audio_features af ON t.track_id  = af.track_id
GROUP BY g.genre_name
ORDER BY g.genre_name;


-- ============================================================
-- SECTION 4: POPULARITY ANALYSIS
-- ============================================================

-- Q12: Popularity buckets — distribution of tracks by score range
SELECT
    CASE
        WHEN track_popularity = 0               THEN '00 (Zero)'
        WHEN track_popularity BETWEEN 1  AND 19 THEN '01-19 (Very Low)'
        WHEN track_popularity BETWEEN 20 AND 39 THEN '20-39 (Low)'
        WHEN track_popularity BETWEEN 40 AND 59 THEN '40-59 (Medium)'
        WHEN track_popularity BETWEEN 60 AND 79 THEN '60-79 (High)'
        ELSE                                         '80-100 (Very High)'
    END                                                                 AS bucket,
    COUNT(*)                                                            AS track_count,
    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2)                AS pct_of_total,
    ROUND(AVG(track_popularity)::NUMERIC, 1)                           AS avg_score_in_bucket
FROM tracks
GROUP BY bucket
ORDER BY bucket;

-- Q13: Popularity vs energy — binned correlation analysis
SELECT
    ROUND((af.energy * 10)::NUMERIC, 0) * 10                      AS energy_decile,
    COUNT(*)                                                        AS track_count,
    ROUND(AVG(t.track_popularity)::NUMERIC, 2)                    AS avg_popularity,
    ROUND(STDDEV(t.track_popularity)::NUMERIC, 2)                 AS std_popularity
FROM tracks t
JOIN audio_features af ON t.track_id = af.track_id
GROUP BY energy_decile
ORDER BY energy_decile;

-- Q14: Popularity vs danceability — binned correlation analysis
SELECT
    ROUND((af.danceability * 10)::NUMERIC, 0) * 10                AS danceability_decile,
    COUNT(*)                                                        AS track_count,
    ROUND(AVG(t.track_popularity)::NUMERIC, 2)                    AS avg_popularity,
    ROUND(STDDEV(t.track_popularity)::NUMERIC, 2)                 AS std_popularity
FROM tracks t
JOIN audio_features af ON t.track_id = af.track_id
GROUP BY danceability_decile
ORDER BY danceability_decile;

-- Q15: Most popular tracks (top 25 with full context)
SELECT
    t.track_name,
    a.artist_name,
    al.album_name,
    al.release_year,
    t.track_popularity,
    t.duration_min,
    af.danceability,
    af.energy,
    af.valence,
    af.tempo,
    STRING_AGG(DISTINCT g.genre_name, ', ' ORDER BY g.genre_name) AS genres
FROM tracks t
JOIN artists        a  ON t.artist_id = a.artist_id
LEFT JOIN albums   al  ON t.album_id  = al.album_id
JOIN audio_features af ON t.track_id  = af.track_id
JOIN playlist_tracks pt ON t.track_id = pt.track_id
JOIN genres         g  ON pt.genre_id = g.genre_id
GROUP BY t.track_id, t.track_name, a.artist_name, al.album_name, al.release_year,
         t.track_popularity, t.duration_min, af.danceability, af.energy, af.valence, af.tempo
ORDER BY t.track_popularity DESC
LIMIT 25;


-- ============================================================
-- SECTION 5: WINDOW FUNCTIONS
-- ============================================================

-- Q17a: Artist ranking within each genre (dense rank by avg popularity)
WITH artist_genre_pop AS (
    SELECT
        a.artist_name,
        g.genre_name,
        COUNT(DISTINCT t.track_id)                                  AS tracks_in_genre,
        ROUND(AVG(t.track_popularity)::NUMERIC, 1)                 AS avg_popularity
    FROM playlist_tracks pt
    JOIN genres         g  ON pt.genre_id = g.genre_id
    JOIN tracks         t  ON pt.track_id = t.track_id
    JOIN artists        a  ON t.artist_id = a.artist_id
    GROUP BY a.artist_name, g.genre_name
    HAVING COUNT(DISTINCT t.track_id) >= 3
)
SELECT
    genre_name,
    artist_name,
    tracks_in_genre,
    avg_popularity,
    DENSE_RANK() OVER (PARTITION BY genre_name ORDER BY avg_popularity DESC) AS rank_within_genre
FROM artist_genre_pop
WHERE rank_within_genre <= 5
ORDER BY genre_name, rank_within_genre;

-- Q17b: Track percentile ranking by popularity within genre
SELECT
    t.track_name,
    a.artist_name,
    g.genre_name,
    t.track_popularity,
    PERCENT_RANK() OVER (PARTITION BY g.genre_name ORDER BY t.track_popularity) AS popularity_percentile,
    NTILE(10) OVER (PARTITION BY g.genre_name ORDER BY t.track_popularity)       AS popularity_decile
FROM tracks t
JOIN artists        a  ON t.artist_id = a.artist_id
JOIN playlist_tracks pt ON t.track_id = pt.track_id
JOIN genres         g  ON pt.genre_id = g.genre_id
ORDER BY g.genre_name, t.track_popularity DESC;

-- Q17c: Running cumulative track count by release year
SELECT
    al.release_year,
    COUNT(DISTINCT t.track_id)                                                  AS tracks_released,
    SUM(COUNT(DISTINCT t.track_id)) OVER (ORDER BY al.release_year)            AS cumulative_tracks,
    ROUND(AVG(t.track_popularity)::NUMERIC, 2)                                 AS avg_popularity
FROM tracks t
JOIN albums al ON t.album_id = al.album_id
WHERE al.release_year IS NOT NULL
GROUP BY al.release_year
ORDER BY al.release_year;


-- ============================================================
-- SECTION 6: CTE-BASED ANALYSES
-- ============================================================

-- Q18a: Genre audio signature comparison using CTEs
-- Computes how each genre's features compare to the global dataset mean
WITH global_means AS (
    SELECT
        AVG(danceability)     AS g_dance,
        AVG(energy)           AS g_energy,
        AVG(loudness)         AS g_loud,
        AVG(valence)          AS g_valence,
        AVG(tempo)            AS g_tempo,
        AVG(speechiness)      AS g_speech
    FROM audio_features
),
genre_means AS (
    SELECT
        gen.genre_name,
        AVG(af.danceability)  AS dance,
        AVG(af.energy)        AS energy,
        AVG(af.loudness)      AS loud,
        AVG(af.valence)       AS valence,
        AVG(af.tempo)         AS tempo,
        AVG(af.speechiness)   AS speech
    FROM playlist_tracks pt
    JOIN genres         gen ON pt.genre_id = gen.genre_id
    JOIN audio_features af  ON pt.track_id = af.track_id
    GROUP BY gen.genre_name
)
SELECT
    gm.genre_name,
    ROUND((gm.dance  - gl.g_dance)  * 100 / NULLIF(gl.g_dance, 0)::NUMERIC, 1)  AS danceability_vs_global_pct,
    ROUND((gm.energy - gl.g_energy) * 100 / NULLIF(gl.g_energy, 0)::NUMERIC, 1) AS energy_vs_global_pct,
    ROUND((gm.valence - gl.g_valence) * 100 / NULLIF(gl.g_valence, 0)::NUMERIC, 1) AS valence_vs_global_pct,
    ROUND((gm.speech - gl.g_speech) * 100 / NULLIF(gl.g_speech, 0)::NUMERIC, 1) AS speechiness_vs_global_pct,
    ROUND((gm.tempo  - gl.g_tempo)  * 100 / NULLIF(gl.g_tempo, 0)::NUMERIC, 1)  AS tempo_vs_global_pct
FROM genre_means gm
CROSS JOIN global_means gl
ORDER BY gm.genre_name;

-- Q18b: Artists appearing in multiple genres (cross-genre artists)
WITH artist_genre_counts AS (
    SELECT
        a.artist_name,
        COUNT(DISTINCT gen.genre_name)          AS genre_count,
        STRING_AGG(DISTINCT gen.genre_name, ', '
                   ORDER BY gen.genre_name)     AS genres_list,
        COUNT(DISTINCT t.track_id)              AS total_tracks,
        ROUND(AVG(t.track_popularity)::NUMERIC, 1) AS avg_popularity
    FROM tracks t
    JOIN artists         a   ON t.artist_id  = a.artist_id
    JOIN playlist_tracks pt  ON t.track_id   = pt.track_id
    JOIN genres          gen ON pt.genre_id  = gen.genre_id
    GROUP BY a.artist_name
)
SELECT *
FROM artist_genre_counts
WHERE genre_count >= 3
ORDER BY genre_count DESC, avg_popularity DESC
LIMIT 30;

-- Q18c: Popularity decay analysis — older vs newer music popularity
WITH decade_bins AS (
    SELECT
        al.release_decade,
        t.track_popularity,
        af.danceability,
        af.energy,
        af.valence
    FROM tracks t
    JOIN albums         al ON t.album_id  = al.album_id
    JOIN audio_features af ON t.track_id  = af.track_id
    WHERE al.release_decade IS NOT NULL
),
decade_stats AS (
    SELECT
        release_decade,
        COUNT(*)                                        AS track_count,
        ROUND(AVG(track_popularity)::NUMERIC, 2)       AS avg_popularity,
        ROUND(AVG(danceability)::NUMERIC, 3)           AS avg_danceability,
        ROUND(AVG(energy)::NUMERIC, 3)                 AS avg_energy,
        ROUND(AVG(valence)::NUMERIC, 3)                AS avg_valence
    FROM decade_bins
    GROUP BY release_decade
)
SELECT
    *,
    -- Year-over-year popularity delta from previous decade
    avg_popularity - LAG(avg_popularity) OVER (ORDER BY release_decade) AS pop_delta_from_prev_decade
FROM decade_stats
ORDER BY release_decade;


-- ============================================================
-- SECTION 7: JOIN-HEAVY ANALYTICAL QUERIES
-- ============================================================

-- Q19: Full-context track analysis — most complete join
-- Combines track metadata, artist, album, audio features, genre context
SELECT
    t.track_id,
    t.track_name,
    a.artist_name,
    al.album_name,
    al.release_year,
    al.release_decade,
    t.track_popularity,
    ROUND(t.duration_min::NUMERIC, 2)           AS duration_min,
    t.duration_category,
    g.genre_name,
    g.subgenre_name,
    af.danceability,
    af.energy,
    af.key,
    af.loudness,
    CASE af.mode WHEN 1 THEN 'Major' ELSE 'Minor' END AS musical_key_mode,
    af.speechiness,
    af.acousticness,
    af.instrumentalness,
    af.liveness,
    af.valence,
    af.tempo,
    -- Derived mood classification
    CASE
        WHEN af.valence >= 0.6 AND af.energy >= 0.6 THEN 'Upbeat/Happy'
        WHEN af.valence >= 0.6 AND af.energy <  0.6 THEN 'Relaxed/Content'
        WHEN af.valence <  0.6 AND af.energy >= 0.6 THEN 'Aggressive/Intense'
        ELSE                                              'Melancholic/Sad'
    END                                         AS mood_quadrant
FROM tracks          t
JOIN artists          a  ON t.artist_id  = a.artist_id
LEFT JOIN albums     al  ON t.album_id   = al.album_id
JOIN audio_features  af  ON t.track_id   = af.track_id
JOIN playlist_tracks pt  ON t.track_id   = pt.track_id
JOIN genres           g  ON pt.genre_id  = g.genre_id
ORDER BY t.track_popularity DESC;

-- Q19b: Albums with multiple top-performing tracks (popularity ≥ 70)
SELECT
    al.album_name,
    a.artist_name,
    al.release_year,
    COUNT(t.track_id)                               AS total_tracks_in_catalog,
    COUNT(CASE WHEN t.track_popularity >= 70 THEN 1 END) AS high_popularity_tracks,
    ROUND(AVG(t.track_popularity)::NUMERIC, 1)     AS album_avg_popularity,
    MAX(t.track_popularity)                         AS peak_track_popularity
FROM tracks t
JOIN artists    a  ON t.artist_id = a.artist_id
JOIN albums    al  ON t.album_id  = al.album_id
GROUP BY al.album_id, al.album_name, a.artist_name, al.release_year
HAVING COUNT(CASE WHEN t.track_popularity >= 70 THEN 1 END) >= 2
ORDER BY high_popularity_tracks DESC, album_avg_popularity DESC;


-- ============================================================
-- SECTION 8: TIME / DERIVED ANALYTICAL QUERIES
-- ============================================================

-- Q20a: Temporal audio feature evolution — how sound changed over decades
SELECT
    al.release_decade,
    COUNT(DISTINCT t.track_id)                      AS track_count,
    ROUND(AVG(af.tempo)::NUMERIC, 1)               AS avg_tempo_bpm,
    ROUND(AVG(af.loudness)::NUMERIC, 2)            AS avg_loudness_db,
    ROUND(AVG(af.danceability)::NUMERIC, 3)        AS avg_danceability,
    ROUND(AVG(af.energy)::NUMERIC, 3)              AS avg_energy,
    ROUND(AVG(af.acousticness)::NUMERIC, 3)        AS avg_acousticness,
    ROUND(AVG(af.valence)::NUMERIC, 3)             AS avg_valence,
    ROUND(AVG(t.track_popularity)::NUMERIC, 2)     AS avg_popularity
FROM tracks t
JOIN albums         al ON t.album_id  = al.album_id
JOIN audio_features af ON t.track_id  = af.track_id
WHERE al.release_decade IS NOT NULL
GROUP BY al.release_decade
ORDER BY al.release_decade;

-- Q20b: Most prolific release months — which months produce the most new music?
SELECT
    al.release_month,
    TO_CHAR(TO_DATE(al.release_month::TEXT, 'MM'), 'Month') AS month_name,
    COUNT(DISTINCT t.track_id)                               AS track_count,
    ROUND(AVG(t.track_popularity)::NUMERIC, 2)              AS avg_popularity
FROM tracks t
JOIN albums al ON t.album_id = al.album_id
WHERE al.release_month IS NOT NULL
GROUP BY al.release_month
ORDER BY track_count DESC;

-- Q20c: Major vs Minor key popularity analysis (mode)
SELECT
    CASE af.mode WHEN 1 THEN 'Major' ELSE 'Minor' END         AS key_mode,
    COUNT(*)                                                    AS track_count,
    ROUND(AVG(t.track_popularity)::NUMERIC, 2)                AS avg_popularity,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY t.track_popularity) AS median_popularity,
    ROUND(AVG(af.valence)::NUMERIC, 3)                        AS avg_valence,
    ROUND(AVG(af.energy)::NUMERIC, 3)                         AS avg_energy
FROM tracks t
JOIN audio_features af ON t.track_id = af.track_id
GROUP BY af.mode
ORDER BY af.mode DESC;

-- Q20d: Mood quadrant distribution — valence/energy segmentation
WITH mood_classified AS (
    SELECT
        CASE
            WHEN af.valence >= 0.6 AND af.energy >= 0.6 THEN 'Upbeat/Happy'
            WHEN af.valence >= 0.6 AND af.energy <  0.6 THEN 'Relaxed/Content'
            WHEN af.valence <  0.6 AND af.energy >= 0.6 THEN 'Aggressive/Intense'
            ELSE                                              'Melancholic/Sad'
        END AS mood_quadrant,
        t.track_popularity,
        gen.genre_name
    FROM tracks t
    JOIN audio_features  af ON t.track_id  = af.track_id
    JOIN playlist_tracks pt ON t.track_id  = pt.track_id
    JOIN genres         gen ON pt.genre_id = gen.genre_id
)
SELECT
    mood_quadrant,
    COUNT(*)                                            AS track_count,
    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 1) AS pct_of_catalog,
    ROUND(AVG(track_popularity)::NUMERIC, 2)           AS avg_popularity,
    STRING_AGG(DISTINCT genre_name, ', '
               ORDER BY genre_name)                    AS top_genres
FROM mood_classified
GROUP BY mood_quadrant
ORDER BY track_count DESC;


-- ============================================================
-- SECTION 9: QUICK VALIDATION QUERIES
-- ============================================================

-- Expected row counts (run after loading data)
SELECT 'artists'       AS table_name, COUNT(*) AS row_count FROM artists
UNION ALL
SELECT 'albums',                       COUNT(*) FROM albums
UNION ALL
SELECT 'tracks',                       COUNT(*) FROM tracks
UNION ALL
SELECT 'audio_features',               COUNT(*) FROM audio_features
UNION ALL
SELECT 'playlist_tracks',              COUNT(*) FROM playlist_tracks
UNION ALL
SELECT 'genres',                       COUNT(*) FROM genres
ORDER BY table_name;

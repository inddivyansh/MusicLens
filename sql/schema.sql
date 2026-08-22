-- ============================================================
-- MusicLens — PostgreSQL Schema (v2.0)
-- ============================================================
-- Normalized star-schema for analytics, BI, and recommendation.
-- Designed for Neon/Supabase free tier and local PostgreSQL.
-- Dataset: Spotify 30,000 Songs (32,828 cleaned rows, 28,352 unique tracks)
-- Application tables (users, sessions, user_profiles, spotify_connections)
-- live in sql/app_schema.sql and MUST NOT be dropped here.
-- ============================================================

-- ============================================================
-- CLEAN SLATE — idempotent re-run support
-- ============================================================
DROP MATERIALIZED VIEW IF EXISTS track_feature_vectors CASCADE;
DROP VIEW IF EXISTS v_genre_audio_profile    CASCADE;
DROP VIEW IF EXISTS v_artist_leaderboard     CASCADE;
DROP VIEW IF EXISTS v_genre_summary          CASCADE;
DROP VIEW IF EXISTS v_popularity_buckets     CASCADE;
DROP VIEW IF EXISTS v_top_tracks             CASCADE;
DROP VIEW IF EXISTS v_release_decade_summary CASCADE;

DROP TABLE IF EXISTS playlist_tracks  CASCADE;
DROP TABLE IF EXISTS audio_features   CASCADE;
DROP TABLE IF EXISTS artist_stats     CASCADE;
DROP TABLE IF EXISTS genre_stats      CASCADE;
DROP TABLE IF EXISTS tracks           CASCADE;
DROP TABLE IF EXISTS artists          CASCADE;
DROP TABLE IF EXISTS genres           CASCADE;
DROP TABLE IF EXISTS albums           CASCADE;

-- ============================================================
-- Dimension: GENRES (6 macro genres, 24 subgenres)
-- ============================================================
CREATE TABLE genres (
    genre_id        SERIAL       PRIMARY KEY,
    genre_name      VARCHAR(50)  NOT NULL,
    subgenre_name   VARCHAR(80)  NOT NULL,
    UNIQUE (genre_name, subgenre_name)
);

COMMENT ON TABLE  genres             IS 'Spotify playlist genre/subgenre taxonomy (6 macro-genres, 24 subgenres).';
COMMENT ON COLUMN genres.genre_name  IS 'Macro-genre: edm, rap, pop, r&b, latin, rock.';
COMMENT ON COLUMN genres.subgenre_name IS 'Spotify playlist-derived subgenre label (4 per macro-genre).';

CREATE INDEX idx_genres_name ON genres (genre_name);

-- ============================================================
-- Dimension: ARTISTS (10,692 unique artists)
-- ============================================================
CREATE TABLE artists (
    artist_id   SERIAL  PRIMARY KEY,
    artist_name TEXT    NOT NULL UNIQUE
);

COMMENT ON TABLE  artists             IS 'Dimension table of unique track artists.';
COMMENT ON COLUMN artists.artist_name IS 'Primary performing artist name, stripped of whitespace.';

CREATE INDEX idx_artists_name ON artists (artist_name);

-- ============================================================
-- Dimension: ALBUMS (unique albums via album_id)
-- ============================================================
CREATE TABLE albums (
    album_id            VARCHAR(62)  PRIMARY KEY,
    album_name          TEXT         NOT NULL,
    release_date        DATE,
    release_year        SMALLINT     CHECK (release_year BETWEEN 1900 AND 2100),
    release_month       SMALLINT     CHECK (release_month BETWEEN 1 AND 12),
    release_decade      VARCHAR(10)
);

COMMENT ON TABLE  albums              IS 'Dimension table of unique Spotify albums or singles.';
COMMENT ON COLUMN albums.album_id     IS '22-character Spotify Base62 album identifier.';
COMMENT ON COLUMN albums.release_date IS 'ISO-8601 date. Incomplete raw dates (YYYY, YYYY-MM) defaulted to first day.';
COMMENT ON COLUMN albums.release_decade IS 'Derived decade label, e.g. 1990s, 2010s.';

CREATE INDEX idx_albums_release_year  ON albums (release_year);
CREATE INDEX idx_albums_release_decade ON albums (release_decade);

-- ============================================================
-- Fact: TRACKS (28,352 unique songs)
-- ============================================================
CREATE TABLE tracks (
    track_id          VARCHAR(62)  PRIMARY KEY,
    track_name        TEXT         NOT NULL,
    artist_id         INTEGER      NOT NULL REFERENCES artists(artist_id),
    album_id          VARCHAR(62)  REFERENCES albums(album_id),
    track_popularity  SMALLINT     CHECK (track_popularity BETWEEN 0 AND 100),
    duration_ms       INTEGER      CHECK (duration_ms > 0),
    duration_min      REAL         GENERATED ALWAYS AS (duration_ms / 60000.0) STORED,
    duration_category TEXT         -- Short, Medium, Standard, Long
);

COMMENT ON TABLE  tracks                  IS 'Core fact table of unique Spotify tracks (28,352 rows after deduplication).';
COMMENT ON COLUMN tracks.track_id         IS '22-character Spotify Base62 track identifier.';
COMMENT ON COLUMN tracks.track_popularity IS 'Spotify popularity 0-100 based on total streams and recency.';
COMMENT ON COLUMN tracks.duration_ms      IS 'Track duration in milliseconds.';
COMMENT ON COLUMN tracks.duration_min     IS 'Track duration in decimal minutes (computed).';

CREATE INDEX idx_tracks_artist_id    ON tracks (artist_id);
CREATE INDEX idx_tracks_popularity   ON tracks (track_popularity);
CREATE INDEX idx_tracks_album_id     ON tracks (album_id);

-- ============================================================
-- Fact: AUDIO FEATURES (1:1 with tracks)
-- ============================================================
CREATE TABLE audio_features (
    track_id          VARCHAR(62)  PRIMARY KEY REFERENCES tracks(track_id) ON DELETE CASCADE,
    danceability      REAL  CHECK (danceability      BETWEEN 0 AND 1),
    energy            REAL  CHECK (energy            BETWEEN 0 AND 1),
    key               SMALLINT CHECK (key            BETWEEN -1 AND 11),
    loudness          REAL  CHECK (loudness          BETWEEN -60 AND 5),
    mode              SMALLINT CHECK (mode           IN (0, 1)),
    speechiness       REAL  CHECK (speechiness       BETWEEN 0 AND 1),
    acousticness      REAL  CHECK (acousticness      BETWEEN 0 AND 1),
    instrumentalness  REAL  CHECK (instrumentalness  BETWEEN 0 AND 1),
    liveness          REAL  CHECK (liveness          BETWEEN 0 AND 1),
    valence           REAL  CHECK (valence           BETWEEN 0 AND 1),
    tempo             REAL  CHECK (tempo             BETWEEN 0 AND 300)
);

COMMENT ON TABLE  audio_features             IS 'Spotify Echo Nest acoustic analysis features (1:1 with tracks).';
COMMENT ON COLUMN audio_features.danceability   IS 'Dance suitability based on tempo, rhythm, beat strength [0,1].';
COMMENT ON COLUMN audio_features.energy         IS 'Perceptual intensity and activity measure [0,1].';
COMMENT ON COLUMN audio_features.key            IS 'Musical key using Pitch Class notation (0=C, 1=C#/Db, ..., 11=B, -1=undetected).';
COMMENT ON COLUMN audio_features.loudness       IS 'Overall track loudness in decibels (typical range -60 to 0 dB).';
COMMENT ON COLUMN audio_features.mode           IS 'Musical modality: 1=Major (brighter), 0=Minor (darker).';
COMMENT ON COLUMN audio_features.speechiness    IS 'Presence of spoken words: >0.66=speech, 0.33-0.66=rap mix, <0.33=music.';
COMMENT ON COLUMN audio_features.acousticness   IS 'Confidence acoustic instruments (not electronic) are dominant [0,1].';
COMMENT ON COLUMN audio_features.instrumentalness IS 'Predicts absence of vocals: >0.5 likely instrumental [0,1].';
COMMENT ON COLUMN audio_features.liveness       IS 'Audience presence probability: >0.8 = strong live performance signal [0,1].';
COMMENT ON COLUMN audio_features.valence        IS 'Musical positiveness/mood: 1=happy/euphoric, 0=sad/angry [0,1].';
COMMENT ON COLUMN audio_features.tempo          IS 'Estimated tempo in beats per minute (BPM).';

-- Query-pattern-driven indexes on the most-filtered features
CREATE INDEX idx_af_danceability ON audio_features (danceability);
CREATE INDEX idx_af_energy       ON audio_features (energy);
CREATE INDEX idx_af_valence      ON audio_features (valence);

-- ============================================================
-- Bridge: PLAYLIST_TRACKS (32,828 track-playlist relationships)
-- ============================================================
CREATE TABLE playlist_tracks (
    id               SERIAL       PRIMARY KEY,
    track_id         VARCHAR(62)  NOT NULL REFERENCES tracks(track_id) ON DELETE CASCADE,
    playlist_id      VARCHAR(62)  NOT NULL,
    playlist_name    TEXT,
    genre_id         INTEGER      NOT NULL REFERENCES genres(genre_id)
);

COMMENT ON TABLE  playlist_tracks            IS 'Many-to-many bridge: tracks appear in multiple playlists across genres.';
COMMENT ON COLUMN playlist_tracks.playlist_id IS '22-character Spotify playlist identifier.';
COMMENT ON COLUMN playlist_tracks.genre_id   IS 'FK to genres dimension for genre/subgenre context.';

CREATE INDEX idx_pt_track_id    ON playlist_tracks (track_id);
CREATE INDEX idx_pt_playlist_id ON playlist_tracks (playlist_id);
CREATE INDEX idx_pt_genre_id    ON playlist_tracks (genre_id);

-- ============================================================
-- Derived: ARTIST STATS (pre-aggregated for dashboard speed)
-- ============================================================
CREATE TABLE artist_stats (
    artist_id            INTEGER  PRIMARY KEY REFERENCES artists(artist_id) ON DELETE CASCADE,
    track_count          INTEGER  NOT NULL DEFAULT 0,
    avg_popularity       REAL,
    max_popularity       SMALLINT,
    min_popularity       SMALLINT,
    avg_danceability     REAL,
    avg_energy           REAL,
    avg_valence          REAL,
    genre_primary        VARCHAR(50)  -- most frequent genre
);

COMMENT ON TABLE artist_stats IS 'Pre-aggregated artist performance metrics; refreshed by pipeline/05_load_to_postgres.py.';

-- ============================================================
-- Derived: GENRE STATS (pre-aggregated for dashboard speed)
-- ============================================================
CREATE TABLE genre_stats (
    genre_name            VARCHAR(50)  PRIMARY KEY,
    track_count           INTEGER      NOT NULL DEFAULT 0,
    unique_track_count    INTEGER      NOT NULL DEFAULT 0,
    avg_popularity        REAL,
    avg_danceability      REAL,
    avg_energy            REAL,
    avg_loudness          REAL,
    avg_speechiness       REAL,
    avg_acousticness      REAL,
    avg_instrumentalness  REAL,
    avg_liveness          REAL,
    avg_valence           REAL,
    avg_tempo             REAL
);

COMMENT ON TABLE genre_stats IS 'Pre-aggregated genre audio profile metrics; refreshed by pipeline/05_load_to_postgres.py.';

-- ============================================================
-- Materialized View: TRACK FEATURE VECTORS (for recommendations)
-- ============================================================
CREATE MATERIALIZED VIEW track_feature_vectors AS
SELECT
    t.track_id,
    t.track_name,
    a.artist_name,
    t.track_popularity,
    STRING_AGG(DISTINCT g.genre_name, ', ' ORDER BY g.genre_name) AS genre_name,
    af.danceability,
    af.energy,
    af.loudness,
    af.speechiness,
    af.acousticness,
    af.instrumentalness,
    af.liveness,
    af.valence,
    af.tempo
FROM tracks t
JOIN artists       a  ON t.artist_id  = a.artist_id
JOIN audio_features af ON t.track_id  = af.track_id
LEFT JOIN playlist_tracks pt ON t.track_id = pt.track_id
LEFT JOIN genres g ON pt.genre_id = g.genre_id
GROUP BY t.track_id, t.track_name, a.artist_name, t.track_popularity,
         af.danceability, af.energy, af.loudness, af.speechiness,
         af.acousticness, af.instrumentalness, af.liveness, af.valence, af.tempo;

-- Unique index required for REFRESH CONCURRENTLY
CREATE UNIQUE INDEX idx_tfv_track_id ON track_feature_vectors (track_id);

-- ============================================================
-- ANALYTICAL VIEWS (dashboard & BI layer)
-- ============================================================

-- V1: Genre Summary — volume, popularity, audio profile
CREATE OR REPLACE VIEW v_genre_summary AS
SELECT
    g.genre_name                                                AS genre,
    COUNT(DISTINCT pt.track_id)                                 AS unique_tracks,
    COUNT(*)                                                    AS playlist_appearances,
    ROUND(AVG(t.track_popularity)::NUMERIC, 2)                 AS avg_popularity,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY t.track_popularity) AS median_popularity,
    ROUND(STDDEV(t.track_popularity)::NUMERIC, 2)              AS stddev_popularity,
    ROUND(AVG(af.danceability)::NUMERIC, 3)                    AS avg_danceability,
    ROUND(AVG(af.energy)::NUMERIC, 3)                          AS avg_energy,
    ROUND(AVG(af.valence)::NUMERIC, 3)                         AS avg_valence,
    ROUND(AVG(af.tempo)::NUMERIC, 1)                           AS avg_tempo,
    ROUND(AVG(af.speechiness)::NUMERIC, 3)                     AS avg_speechiness,
    ROUND(AVG(af.acousticness)::NUMERIC, 3)                    AS avg_acousticness
FROM playlist_tracks pt
JOIN genres         g  ON pt.genre_id  = g.genre_id
JOIN tracks         t  ON pt.track_id  = t.track_id
JOIN audio_features af ON t.track_id   = af.track_id
GROUP BY g.genre_name
ORDER BY unique_tracks DESC;

-- V2: Artist Leaderboard — popularity-ranked artists with min 3 tracks
CREATE OR REPLACE VIEW v_artist_leaderboard AS
SELECT
    a.artist_name,
    COUNT(*)                                        AS track_count,
    ROUND(AVG(t.track_popularity)::NUMERIC, 1)     AS avg_popularity,
    MAX(t.track_popularity)                         AS max_popularity,
    MIN(t.track_popularity)                         AS min_popularity,
    ROUND(STDDEV(t.track_popularity)::NUMERIC, 1)  AS stddev_popularity
FROM tracks t
JOIN artists a ON t.artist_id = a.artist_id
GROUP BY a.artist_name
HAVING COUNT(*) >= 3
ORDER BY avg_popularity DESC;

-- V3: Popularity Buckets — how tracks distribute across score ranges
CREATE OR REPLACE VIEW v_popularity_buckets AS
SELECT
    CASE
        WHEN track_popularity = 0               THEN '00_Zero'
        WHEN track_popularity BETWEEN 1  AND 19 THEN '01-19_Very Low'
        WHEN track_popularity BETWEEN 20 AND 39 THEN '20-39_Low'
        WHEN track_popularity BETWEEN 40 AND 59 THEN '40-59_Medium'
        WHEN track_popularity BETWEEN 60 AND 79 THEN '60-79_High'
        WHEN track_popularity BETWEEN 80 AND 100 THEN '80-100_Very High'
    END                                     AS popularity_bucket,
    COUNT(*)                                AS track_count,
    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) AS pct_of_total
FROM tracks
GROUP BY popularity_bucket
ORDER BY popularity_bucket;

-- V4: Top Tracks — most popular songs with full context
CREATE OR REPLACE VIEW v_top_tracks AS
SELECT
    t.track_id,
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
JOIN artists        a  ON t.artist_id  = a.artist_id
LEFT JOIN albums   al  ON t.album_id   = al.album_id
JOIN audio_features af ON t.track_id   = af.track_id
JOIN playlist_tracks pt ON t.track_id  = pt.track_id
JOIN genres         g  ON pt.genre_id  = g.genre_id
GROUP BY t.track_id, t.track_name, a.artist_name, al.album_name, al.release_year,
         t.track_popularity, t.duration_min, af.danceability, af.energy, af.valence, af.tempo
ORDER BY t.track_popularity DESC;

-- V5: Release Decade Summary — catalog evolution over time
CREATE OR REPLACE VIEW v_release_decade_summary AS
SELECT
    al.release_decade,
    COUNT(DISTINCT t.track_id)                          AS track_count,
    ROUND(AVG(t.track_popularity)::NUMERIC, 2)         AS avg_popularity,
    ROUND(AVG(af.danceability)::NUMERIC, 3)            AS avg_danceability,
    ROUND(AVG(af.energy)::NUMERIC, 3)                  AS avg_energy,
    ROUND(AVG(af.valence)::NUMERIC, 3)                 AS avg_valence,
    ROUND(AVG(af.tempo)::NUMERIC, 1)                   AS avg_tempo
FROM tracks t
JOIN albums         al ON t.album_id  = al.album_id
JOIN audio_features af ON t.track_id  = af.track_id
WHERE al.release_decade IS NOT NULL
GROUP BY al.release_decade
ORDER BY al.release_decade;

-- V6: Genre Audio Profile — full feature comparison across genres
CREATE OR REPLACE VIEW v_genre_audio_profile AS
SELECT
    g.genre_name,
    g.subgenre_name,
    COUNT(DISTINCT pt.track_id)                         AS track_count,
    ROUND(AVG(af.danceability)::NUMERIC, 3)            AS avg_danceability,
    ROUND(AVG(af.energy)::NUMERIC, 3)                  AS avg_energy,
    ROUND(AVG(af.loudness)::NUMERIC, 2)                AS avg_loudness_db,
    ROUND(AVG(af.speechiness)::NUMERIC, 3)             AS avg_speechiness,
    ROUND(AVG(af.acousticness)::NUMERIC, 3)            AS avg_acousticness,
    ROUND(AVG(af.instrumentalness)::NUMERIC, 3)        AS avg_instrumentalness,
    ROUND(AVG(af.liveness)::NUMERIC, 3)                AS avg_liveness,
    ROUND(AVG(af.valence)::NUMERIC, 3)                 AS avg_valence,
    ROUND(AVG(af.tempo)::NUMERIC, 1)                   AS avg_tempo_bpm,
    ROUND(AVG(t.track_popularity)::NUMERIC, 2)         AS avg_popularity
FROM playlist_tracks pt
JOIN genres          g  ON pt.genre_id  = g.genre_id
JOIN tracks          t  ON pt.track_id  = t.track_id
JOIN audio_features  af ON t.track_id   = af.track_id
GROUP BY g.genre_name, g.subgenre_name
ORDER BY g.genre_name, track_count DESC;

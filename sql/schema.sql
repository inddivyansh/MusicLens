-- ============================================================
-- MusicLens — PostgreSQL Schema
-- ============================================================
-- Star schema optimized for analytics queries.
-- Designed for Neon PostgreSQL free tier (0.5GB limit).
-- ============================================================

-- Drop existing objects for idempotent re-runs
DROP MATERIALIZED VIEW IF EXISTS track_feature_vectors CASCADE;
DROP TABLE IF EXISTS playlist_tracks CASCADE;
DROP TABLE IF EXISTS audio_features CASCADE;
DROP TABLE IF EXISTS tracks CASCADE;

-- ============================================================
-- Dimension: Tracks (unique songs)
-- ============================================================
CREATE TABLE tracks (
    track_id            VARCHAR(62)  PRIMARY KEY,
    track_name          TEXT         NOT NULL,
    track_artist        TEXT         NOT NULL,
    track_popularity    INTEGER      CHECK (track_popularity >= 0 AND track_popularity <= 100),
    duration_ms         INTEGER      CHECK (duration_ms > 0),
    album_id            VARCHAR(62),
    album_name          TEXT,
    album_release_date  DATE
);

CREATE INDEX idx_tracks_artist ON tracks (track_artist);
CREATE INDEX idx_tracks_popularity ON tracks (track_popularity);
CREATE INDEX idx_tracks_album_release ON tracks (album_release_date);

-- ============================================================
-- Fact: Audio Features (1:1 with tracks)
-- ============================================================
CREATE TABLE audio_features (
    track_id            VARCHAR(62)  PRIMARY KEY REFERENCES tracks(track_id) ON DELETE CASCADE,
    danceability        REAL         CHECK (danceability >= 0 AND danceability <= 1),
    energy              REAL         CHECK (energy >= 0 AND energy <= 1),
    key                 SMALLINT     CHECK (key >= -1 AND key <= 11),
    loudness            REAL,
    mode                SMALLINT     CHECK (mode IN (0, 1)),
    speechiness         REAL         CHECK (speechiness >= 0 AND speechiness <= 1),
    acousticness        REAL         CHECK (acousticness >= 0 AND acousticness <= 1),
    instrumentalness    REAL         CHECK (instrumentalness >= 0 AND instrumentalness <= 1),
    liveness            REAL         CHECK (liveness >= 0 AND liveness <= 1),
    valence             REAL         CHECK (valence >= 0 AND valence <= 1),
    tempo               REAL         CHECK (tempo > 0)
);

-- ============================================================
-- Bridge: Playlist-Track Relationships (many-to-many)
-- ============================================================
CREATE TABLE playlist_tracks (
    id                  SERIAL       PRIMARY KEY,
    track_id            VARCHAR(62)  NOT NULL REFERENCES tracks(track_id) ON DELETE CASCADE,
    playlist_id         VARCHAR(62)  NOT NULL,
    playlist_name       TEXT,
    playlist_genre      VARCHAR(50)  NOT NULL,
    playlist_subgenre   VARCHAR(80)
);

CREATE INDEX idx_pt_track_id ON playlist_tracks (track_id);
CREATE INDEX idx_pt_playlist_id ON playlist_tracks (playlist_id);
CREATE INDEX idx_pt_genre ON playlist_tracks (playlist_genre);
CREATE INDEX idx_pt_subgenre ON playlist_tracks (playlist_subgenre);

-- ============================================================
-- Materialized View: Feature Vectors for Recommendations
-- ============================================================
-- Flattened view joining tracks + audio features for fast
-- similarity queries. Refresh after data loads.
-- ============================================================
CREATE MATERIALIZED VIEW track_feature_vectors AS
SELECT
    t.track_id,
    t.track_name,
    t.track_artist,
    t.track_popularity,
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
JOIN audio_features af ON t.track_id = af.track_id;

-- Unique index required for REFRESH CONCURRENTLY
CREATE UNIQUE INDEX idx_tfv_track_id ON track_feature_vectors (track_id);

-- ============================================================
-- Analytical Views
-- ============================================================

-- Genre distribution summary
CREATE OR REPLACE VIEW genre_summary AS
SELECT
    pt.playlist_genre,
    COUNT(DISTINCT pt.track_id) AS unique_tracks,
    COUNT(*) AS playlist_appearances,
    ROUND(AVG(t.track_popularity)::numeric, 2) AS avg_popularity,
    ROUND(AVG(af.danceability)::numeric, 3) AS avg_danceability,
    ROUND(AVG(af.energy)::numeric, 3) AS avg_energy,
    ROUND(AVG(af.valence)::numeric, 3) AS avg_valence,
    ROUND(AVG(af.tempo)::numeric, 1) AS avg_tempo
FROM playlist_tracks pt
JOIN tracks t ON pt.track_id = t.track_id
JOIN audio_features af ON t.track_id = af.track_id
GROUP BY pt.playlist_genre
ORDER BY unique_tracks DESC;

-- Artist popularity leaderboard
CREATE OR REPLACE VIEW artist_leaderboard AS
SELECT
    t.track_artist,
    COUNT(*) AS track_count,
    ROUND(AVG(t.track_popularity)::numeric, 1) AS avg_popularity,
    MAX(t.track_popularity) AS max_popularity
FROM tracks t
GROUP BY t.track_artist
HAVING COUNT(*) >= 3
ORDER BY avg_popularity DESC;

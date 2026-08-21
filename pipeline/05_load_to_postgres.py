"""
Step 5: PostgreSQL Data Loader
================================
Loads all cleaned star-schema tables from data/cleaned/ into PostgreSQL.
Supports both Neon/Supabase (via DATABASE_URL env var) and local PostgreSQL.
Run this script once to initialize the database; re-run to refresh.

Order of operations (respects FK constraints):
  1. Apply schema (DDL)
  2. Load genres   (dimension, no FK deps)
  3. Load artists  (dimension, no FK deps)
  4. Load albums   (dimension, no FK deps)
  5. Load tracks   (depends: artists, albums)
  6. Load audio_features (depends: tracks)
  7. Load playlist_tracks (depends: tracks, genres)
  8. Populate artist_stats & genre_stats (aggregated caches)
  9. Refresh materialized view
"""

import sys
import time
from pathlib import Path

# Add project root to sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import pandas as pd
import numpy as np
from sqlalchemy import text

from pipeline.config import CLEANED_DATA_DIR, SQL_DIR
from pipeline.utils.db import get_engine, execute_schema, test_connection


def load_table(
    df: pd.DataFrame,
    table_name: str,
    engine,
    if_exists: str = "append",
    chunk_size: int = 5000,
) -> int:
    """
    Load a DataFrame into a PostgreSQL table using fast bulk COPY via pandas.

    Args:
        df: DataFrame to load.
        table_name: Target table name.
        engine: SQLAlchemy engine.
        if_exists: 'append' or 'replace'. Always 'append' here (schema pre-created).
        chunk_size: Rows per insert batch.

    Returns:
        Number of rows loaded.
    """
    df.to_sql(
        table_name,
        engine,
        if_exists=if_exists,
        index=False,
        chunksize=chunk_size,
        method="multi",
    )
    print(f"  [Load] {table_name}: {len(df):,} rows loaded.")
    return len(df)


def run_pipeline() -> None:
    print("=" * 65)
    print("  MusicLens — Database Loader (Step 05)")
    print("=" * 65)

    # ------------------------------------------------------------------
    # 0. Verify connectivity
    # ------------------------------------------------------------------
    if not test_connection():
        raise SystemExit(
            "\n[ERROR] Cannot connect to the database.\n"
            "  → Set DATABASE_URL in your .env file.\n"
            "  → For local PostgreSQL: postgresql+psycopg2://user:pass@localhost:5432/musiclens\n"
            "  → For Neon: postgresql+psycopg2://user:pass@ep-xxx.us-east-2.aws.neon.tech/musiclens?sslmode=require\n"
        )

    # ------------------------------------------------------------------
    # 1. Apply schema (idempotent — drops and recreates all objects)
    # ------------------------------------------------------------------
    print("\n[Step 1] Applying schema...")
    execute_schema()

    engine = get_engine(pooling=False)
    t_start = time.time()

    # ------------------------------------------------------------------
    # 2. Load source data
    # ------------------------------------------------------------------
    print("\n[Step 2] Reading cleaned data files...")
    tracks_raw   = pd.read_csv(CLEANED_DATA_DIR / "tracks.csv")
    audio_raw    = pd.read_csv(CLEANED_DATA_DIR / "audio_features.csv")
    pt_raw       = pd.read_csv(CLEANED_DATA_DIR / "playlist_tracks.csv")
    cleaned_full = pd.read_csv(CLEANED_DATA_DIR / "spotify_songs_cleaned.csv")

    print(f"  tracks: {len(tracks_raw):,} rows")
    print(f"  audio_features: {len(audio_raw):,} rows")
    print(f"  playlist_tracks: {len(pt_raw):,} rows")

    # ------------------------------------------------------------------
    # 3. GENRES dimension
    # ------------------------------------------------------------------
    print("\n[Step 3] Loading genres dimension...")
    genres_df = (
        cleaned_full[["playlist_genre", "playlist_subgenre"]]
        .drop_duplicates()
        .rename(columns={"playlist_genre": "genre_name", "playlist_subgenre": "subgenre_name"})
        .sort_values(["genre_name", "subgenre_name"])
        .reset_index(drop=True)
    )
    load_table(genres_df, "genres", engine)

    # Build genre lookup: (genre_name, subgenre_name) -> genre_id
    with engine.connect() as conn:
        genre_rows = conn.execute(
            text("SELECT genre_id, genre_name, subgenre_name FROM genres")
        ).fetchall()
    genre_lookup = {(r.genre_name, r.subgenre_name): r.genre_id for r in genre_rows}

    # ------------------------------------------------------------------
    # 4. ARTISTS dimension
    # ------------------------------------------------------------------
    print("\n[Step 4] Loading artists dimension...")
    artists_df = (
        tracks_raw[["track_artist"]]
        .drop_duplicates()
        .rename(columns={"track_artist": "artist_name"})
        .sort_values("artist_name")
        .reset_index(drop=True)
    )
    load_table(artists_df, "artists", engine)

    # Build artist lookup: artist_name -> artist_id
    with engine.connect() as conn:
        artist_rows = conn.execute(
            text("SELECT artist_id, artist_name FROM artists")
        ).fetchall()
    artist_lookup = {r.artist_name: r.artist_id for r in artist_rows}

    # ------------------------------------------------------------------
    # 5. ALBUMS dimension
    # ------------------------------------------------------------------
    print("\n[Step 5] Loading albums dimension...")
    albums_df = (
        tracks_raw[["track_album_id", "track_album_name", "standard_release_date",
                    "release_year", "release_month", "release_decade"]]
        .drop_duplicates(subset=["track_album_id"])
        .rename(columns={
            "track_album_id":        "album_id",
            "track_album_name":      "album_name",
            "standard_release_date": "release_date",
        })
        .reset_index(drop=True)
    )
    # Convert release_date to proper date or None
    albums_df["release_date"] = pd.to_datetime(
        albums_df["release_date"], errors="coerce"
    ).dt.date
    albums_df["release_year"]  = pd.to_numeric(albums_df["release_year"],  errors="coerce").astype("Int64")
    albums_df["release_month"] = pd.to_numeric(albums_df["release_month"], errors="coerce").astype("Int64")
    load_table(albums_df, "albums", engine)

    # ------------------------------------------------------------------
    # 6. TRACKS fact table
    # ------------------------------------------------------------------
    print("\n[Step 6] Loading tracks fact table...")
    tracks_df = tracks_raw.copy()
    tracks_df["artist_id"] = tracks_df["track_artist"].map(artist_lookup)

    # Handle rows where album_id is null (some tracks have no album)
    tracks_df["track_album_id"] = tracks_df["track_album_id"].where(
        tracks_df["track_album_id"].notna(), other=None
    )

    tracks_load = tracks_df[[
        "track_id", "track_name", "artist_id", "track_album_id",
        "track_popularity", "duration_ms", "duration_category"
    ]].rename(columns={"track_album_id": "album_id"})

    load_table(tracks_load, "tracks", engine)

    # ------------------------------------------------------------------
    # 7. AUDIO FEATURES fact table
    # ------------------------------------------------------------------
    print("\n[Step 7] Loading audio features fact table...")
    audio_load = audio_raw[[
        "track_id", "danceability", "energy", "key", "loudness", "mode",
        "speechiness", "acousticness", "instrumentalness", "liveness",
        "valence", "tempo"
    ]]
    load_table(audio_load, "audio_features", engine)

    # ------------------------------------------------------------------
    # 8. PLAYLIST_TRACKS bridge table
    # ------------------------------------------------------------------
    print("\n[Step 8] Loading playlist_tracks bridge table...")
    pt_df = cleaned_full[[
        "track_id", "playlist_id", "playlist_name",
        "playlist_genre", "playlist_subgenre"
    ]].copy()

    # Map to genre_id using (genre, subgenre) composite lookup
    pt_df["genre_id"] = pt_df.apply(
        lambda r: genre_lookup.get((r["playlist_genre"], r["playlist_subgenre"])),
        axis=1
    )
    pt_load = pt_df[["track_id", "playlist_id", "playlist_name", "genre_id"]]
    load_table(pt_load, "playlist_tracks", engine)

    # ------------------------------------------------------------------
    # 9. ARTIST_STATS aggregated cache
    # ------------------------------------------------------------------
    print("\n[Step 9] Computing and loading artist_stats cache...")
    with engine.connect() as conn:
        artist_stat_rows = conn.execute(text("""
            SELECT
                t.artist_id,
                COUNT(t.track_id)                            AS track_count,
                AVG(t.track_popularity)                      AS avg_popularity,
                MAX(t.track_popularity)                      AS max_popularity,
                MIN(t.track_popularity)                      AS min_popularity,
                AVG(af.danceability)                         AS avg_danceability,
                AVG(af.energy)                               AS avg_energy,
                AVG(af.valence)                              AS avg_valence,
                MODE() WITHIN GROUP (ORDER BY g.genre_name)  AS genre_primary
            FROM tracks t
            JOIN audio_features  af ON t.track_id = af.track_id
            JOIN playlist_tracks pt ON t.track_id = pt.track_id
            JOIN genres           g ON pt.genre_id = g.genre_id
            GROUP BY t.artist_id
        """)).fetchall()

    artist_stats_df = pd.DataFrame(
        [dict(r._mapping) for r in artist_stat_rows]
    )
    for col in ["avg_popularity", "avg_danceability", "avg_energy", "avg_valence"]:
        artist_stats_df[col] = pd.to_numeric(artist_stats_df[col], errors="coerce")
        artist_stats_df[col] = artist_stats_df[col].round(3)
    load_table(artist_stats_df, "artist_stats", engine)

    # ------------------------------------------------------------------
    # 10. GENRE_STATS aggregated cache
    # ------------------------------------------------------------------
    print("\n[Step 10] Computing and loading genre_stats cache...")
    with engine.connect() as conn:
        genre_stat_rows = conn.execute(text("""
            SELECT
                g.genre_name,
                COUNT(*)                       AS track_count,
                COUNT(DISTINCT pt.track_id)    AS unique_track_count,
                AVG(t.track_popularity)        AS avg_popularity,
                AVG(af.danceability)           AS avg_danceability,
                AVG(af.energy)                 AS avg_energy,
                AVG(af.loudness)               AS avg_loudness,
                AVG(af.speechiness)            AS avg_speechiness,
                AVG(af.acousticness)           AS avg_acousticness,
                AVG(af.instrumentalness)       AS avg_instrumentalness,
                AVG(af.liveness)               AS avg_liveness,
                AVG(af.valence)                AS avg_valence,
                AVG(af.tempo)                  AS avg_tempo
            FROM playlist_tracks pt
            JOIN genres          g  ON pt.genre_id = g.genre_id
            JOIN tracks          t  ON pt.track_id = t.track_id
            JOIN audio_features  af ON t.track_id  = af.track_id
            GROUP BY g.genre_name
        """)).fetchall()

    genre_stats_df = pd.DataFrame([dict(r._mapping) for r in genre_stat_rows])
    for col in [c for c in genre_stats_df.columns if c.startswith("avg_")]:
        genre_stats_df[col] = pd.to_numeric(genre_stats_df[col], errors="coerce")
        genre_stats_df[col] = genre_stats_df[col].round(4)
    load_table(genre_stats_df, "genre_stats", engine)

    # ------------------------------------------------------------------
    # 11. Refresh materialized view
    # ------------------------------------------------------------------
    print("\n[Step 11] Refreshing materialized view track_feature_vectors...")
    with engine.begin() as conn:
        conn.execute(text("REFRESH MATERIALIZED VIEW CONCURRENTLY track_feature_vectors"))
    print("  [Load] Materialized view refreshed.")

    # ------------------------------------------------------------------
    # Done
    # ------------------------------------------------------------------
    elapsed = time.time() - t_start
    print(f"\n{'='*65}")
    print(f"  [Done] Full pipeline completed in {elapsed:.1f}s")
    print(f"{'='*65}")


if __name__ == "__main__":
    run_pipeline()

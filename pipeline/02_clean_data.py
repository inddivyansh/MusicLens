"""
Step 2: Data Cleaning & Preprocessing Pipeline
==============================================
Cleans raw Spotify data, handles missing values, normalizes datatypes and dates,
validates feature domain constraints, and exports normalized star-schema
tables along with the unified cleaned dataset.
"""

import sys
from pathlib import Path

# Add project root to sys.path if running directly
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from typing import Tuple, Dict, Any
import numpy as np
import pandas as pd
from pipeline.config import (
    RAW_DATA_DIR,
    CLEANED_DATA_DIR,
    RAW_CSV_FILENAME,
    CLEANED_CSV_FILENAME,
    AUDIO_FEATURE_COLS,
    TRACK_META_COLS,
    PLAYLIST_COLS,
)

# Audio feature boundary definitions from Spotify API specification
FEATURE_BOUNDS = {
    "danceability": (0.0, 1.0),
    "energy": (0.0, 1.0),
    "key": (-1, 11),
    "loudness": (-60.0, 5.0),
    "mode": (0, 1),
    "speechiness": (0.0, 1.0),
    "acousticness": (0.0, 1.0),
    "instrumentalness": (0.0, 1.0),
    "liveness": (0.0, 1.0),
    "valence": (0.0, 1.0),
    "tempo": (0.0, 300.0),
    "duration_ms": (1000, 3600000),  # 1 sec to 1 hour
    "track_popularity": (0, 100),
}


def load_raw_data(raw_csv_path: Path = None) -> pd.DataFrame:
    """Load raw dataset from disk."""
    if raw_csv_path is None:
        raw_csv_path = RAW_DATA_DIR / RAW_CSV_FILENAME

    if not raw_csv_path.exists():
        raise FileNotFoundError(f"Raw dataset not found at {raw_csv_path}. Run 01_download_data.py first.")

    print(f"[Clean] Loading raw dataset from: {raw_csv_path}")
    df = pd.read_csv(raw_csv_path)
    print(f"[Clean] Loaded {len(df):,} raw rows across {len(df.columns)} columns.")
    return df


def clean_and_preprocess(raw_df: pd.DataFrame) -> Tuple[pd.DataFrame, Dict[str, Any]]:
    """
    Execute end-to-end cleaning pipeline.

    Returns:
        Tuple of (cleaned_df, cleaning_metrics_dict)
    """
    df = raw_df.copy()
    initial_rows = len(df)
    metrics: Dict[str, Any] = {
        "initial_rows": initial_rows,
        "initial_columns": len(df.columns),
    }

    # 1. Text normalization & whitespace stripping
    string_cols = df.select_dtypes(include=["object"]).columns
    for col in string_cols:
        df[col] = df[col].astype(str).str.strip()
        # Convert string 'nan' / 'None' to true NaN
        df.loc[df[col].isin(["nan", "None", "NULL", ""]), col] = np.nan

    # 2. Missing Value Analysis & Handling
    null_counts_before = df.isnull().sum().to_dict()
    missing_meta_mask = df["track_name"].isnull() | df["track_artist"].isnull() | df["track_album_name"].isnull()
    dropped_missing_rows = int(missing_meta_mask.sum())

    df = df[~missing_meta_mask].copy()
    metrics["dropped_missing_rows"] = dropped_missing_rows
    metrics["null_counts_before"] = null_counts_before
    print(f"[Clean] Dropped {dropped_missing_rows} rows missing vital track metadata.")

    # 3. Release Date Standardization & Extraction
    # Format variations in dataset: 'YYYY-MM-DD' (30,947), 'YYYY' (1,855), 'YYYY-MM' (31)
    def parse_release_date(date_str: str):
        if pd.isna(date_str):
            return None, None, None, None
        s = str(date_str).strip()
        try:
            if len(s) == 4 and s.isdigit():
                year = int(s)
                return f"{year:04d}-01-01", year, 1, f"{(year // 10) * 10}s"
            elif len(s) == 7 and s[:4].isdigit():
                parts = s.split("-")
                year, month = int(parts[0]), int(parts[1])
                return f"{year:04d}-{month:02d}-01", year, month, f"{(year // 10) * 10}s"
            elif len(s) >= 10 and s[:4].isdigit():
                parts = s.split("-")
                year, month, day = int(parts[0]), int(parts[1]), int(parts[2][:2])
                return f"{year:04d}-{month:02d}-{day:02d}", year, month, f"{(year // 10) * 10}s"
        except Exception:
            pass
        return None, None, None, None

    date_parsed = df["track_album_release_date"].apply(parse_release_date)
    df["standard_release_date"] = [p[0] for p in date_parsed]
    df["release_year"] = [p[1] for p in date_parsed]
    df["release_month"] = [p[2] for p in date_parsed]
    df["release_decade"] = [p[3] for p in date_parsed]

    # Fill any unparseable release dates with album release string
    df["standard_release_date"] = df["standard_release_date"].fillna(df["track_album_release_date"])

    # 4. Numeric Type Coercion & Bounds Validation
    int_cols = ["track_popularity", "duration_ms", "key", "mode"]
    for col in int_cols:
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0).astype(int)

    float_cols = [c for c in AUDIO_FEATURE_COLS if c not in ["key", "mode"]]
    for col in float_cols:
        df[col] = pd.to_numeric(df[col], errors="coerce").astype(float)

    # Validate against known domain bounds
    bound_violations = {}
    for col, (b_min, b_max) in FEATURE_BOUNDS.items():
        if col in df.columns:
            violations = int(((df[col] < b_min) | (df[col] > b_max)).sum())
            bound_violations[col] = violations
    metrics["bound_violations"] = bound_violations

    # 5. Add Duration in Minutes & Song Length Category
    df["duration_min"] = (df["duration_ms"] / 60000.0).round(2)
    df["duration_category"] = pd.cut(
        df["duration_min"],
        bins=[0, 2.5, 3.5, 5.0, 100.0],
        labels=["Short (<2.5m)", "Medium (2.5-3.5m)", "Standard (3.5-5m)", "Long (>5m)"]
    )

    # 6. Summary metrics
    metrics["final_cleaned_rows"] = len(df)
    metrics["unique_tracks"] = df["track_id"].nunique()
    metrics["unique_artists"] = df["track_artist"].nunique()
    metrics["unique_albums"] = df["track_album_id"].nunique()
    metrics["unique_playlists"] = df["playlist_id"].nunique()
    metrics["genres"] = list(df["playlist_genre"].unique())
    metrics["subgenres_count"] = df["playlist_subgenre"].nunique()

    print(
        f"[Clean] Preprocessing complete. Final clean rows: {len(df):,}, "
        f"Unique tracks: {metrics['unique_tracks']:,}, Unique artists: {metrics['unique_artists']:,}"
    )
    return df, metrics


def export_cleaned_data(cleaned_df: pd.DataFrame) -> Dict[str, Path]:
    """
    Export cleaned datasets in both denormalized flat files and
    normalized star-schema relational tables (CSV and Parquet).
    """
    CLEANED_DATA_DIR.mkdir(parents=True, exist_ok=True)
    exported_paths = {}

    # 1. Denormalized full cleaned dataset (32,828 rows)
    flat_csv = CLEANED_DATA_DIR / CLEANED_CSV_FILENAME
    flat_parquet = CLEANED_DATA_DIR / "spotify_songs_cleaned.parquet"
    cleaned_df.to_csv(flat_csv, index=False)
    cleaned_df.to_parquet(flat_parquet, index=False)
    exported_paths["flat_csv"] = flat_csv
    exported_paths["flat_parquet"] = flat_parquet

    # 2. Dimension: Tracks (28,352 unique rows)
    tracks_cols = [
        "track_id",
        "track_name",
        "track_artist",
        "track_popularity",
        "duration_ms",
        "duration_min",
        "duration_category",
        "track_album_id",
        "track_album_name",
        "standard_release_date",
        "release_year",
        "release_month",
        "release_decade",
    ]
    tracks_df = cleaned_df[tracks_cols].drop_duplicates(subset=["track_id"]).reset_index(drop=True)
    tracks_csv = CLEANED_DATA_DIR / "tracks.csv"
    tracks_parquet = CLEANED_DATA_DIR / "tracks.parquet"
    tracks_df.to_csv(tracks_csv, index=False)
    tracks_df.to_parquet(tracks_parquet, index=False)
    exported_paths["tracks_csv"] = tracks_csv
    exported_paths["tracks_parquet"] = tracks_parquet

    # 3. Fact: Audio Features (28,352 unique rows)
    af_cols = ["track_id"] + AUDIO_FEATURE_COLS
    audio_features_df = cleaned_df[af_cols].drop_duplicates(subset=["track_id"]).reset_index(drop=True)
    af_csv = CLEANED_DATA_DIR / "audio_features.csv"
    af_parquet = CLEANED_DATA_DIR / "audio_features.parquet"
    audio_features_df.to_csv(af_csv, index=False)
    audio_features_df.to_parquet(af_parquet, index=False)
    exported_paths["audio_features_csv"] = af_csv
    exported_paths["audio_features_parquet"] = af_parquet

    # 4. Bridge / Fact: Playlist Tracks (32,828 rows)
    pt_cols = ["track_id", "playlist_id", "playlist_name", "playlist_genre", "playlist_subgenre"]
    playlist_tracks_df = cleaned_df[pt_cols].copy().reset_index(drop=True)
    playlist_tracks_df.insert(0, "id", range(1, len(playlist_tracks_df) + 1))
    pt_csv = CLEANED_DATA_DIR / "playlist_tracks.csv"
    pt_parquet = CLEANED_DATA_DIR / "playlist_tracks.parquet"
    playlist_tracks_df.to_csv(pt_csv, index=False)
    playlist_tracks_df.to_parquet(pt_parquet, index=False)
    exported_paths["playlist_tracks_csv"] = pt_csv
    exported_paths["playlist_tracks_parquet"] = pt_parquet

    print("[Clean] Exported cleaned files:")
    for key, path in exported_paths.items():
        print(f"  - {key}: {path} ({path.stat().st_size:,} bytes)")

    return exported_paths


if __name__ == "__main__":
    raw_df = load_raw_data()
    cleaned_df, metrics = clean_and_preprocess(raw_df)
    export_cleaned_data(cleaned_df)
    print("[Clean] Step 02 (Data Cleaning & Preprocessing) completed successfully.")

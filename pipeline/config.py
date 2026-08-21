"""
MusicLens Pipeline Configuration
=================================
Centralized configuration for paths, database connection, and constants.
All secrets are read from environment variables (via .env file in dev).
"""

import os
from pathlib import Path
from dotenv import load_dotenv

# ---------------------------------------------------------------------------
# Load .env file (no-op in production where env vars are set externally)
# ---------------------------------------------------------------------------
load_dotenv()

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "data"
RAW_DATA_DIR = DATA_DIR / "raw"
CLEANED_DATA_DIR = DATA_DIR / "cleaned"
EXPORTS_DIR = DATA_DIR / "exports"
FRONTEND_ANALYTICS_DIR = PROJECT_ROOT / "frontend" / "public" / "analytics"
SQL_DIR = PROJECT_ROOT / "sql"

# Ensure data directories exist
for dir_path in [RAW_DATA_DIR, CLEANED_DATA_DIR, EXPORTS_DIR]:
    dir_path.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------
DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql+psycopg2://localhost:5432/musiclens"  # fallback for local PG
)

# ---------------------------------------------------------------------------
# Dataset
# ---------------------------------------------------------------------------
KAGGLE_DATASET = "joebeachcapital/30000-spotify-songs"
RAW_CSV_FILENAME = "spotify_songs.csv"
CLEANED_CSV_FILENAME = "spotify_songs_cleaned.csv"

# ---------------------------------------------------------------------------
# Audio Feature Columns (used across multiple pipeline steps)
# ---------------------------------------------------------------------------
AUDIO_FEATURE_COLS = [
    "danceability",
    "energy",
    "key",
    "loudness",
    "mode",
    "speechiness",
    "acousticness",
    "instrumentalness",
    "liveness",
    "valence",
    "tempo",
]

# Subset used for recommendations (continuous features, excluding key/mode)
RECOMMENDATION_FEATURES = [
    "danceability",
    "energy",
    "loudness",
    "speechiness",
    "acousticness",
    "instrumentalness",
    "liveness",
    "valence",
    "tempo",
]

# ---------------------------------------------------------------------------
# Metadata Columns
# ---------------------------------------------------------------------------
TRACK_META_COLS = [
    "track_id",
    "track_name",
    "track_artist",
    "track_popularity",
    "track_album_id",
    "track_album_name",
    "track_album_release_date",
    "duration_ms",
]

PLAYLIST_COLS = [
    "track_id",
    "playlist_id",
    "playlist_name",
    "playlist_genre",
    "playlist_subgenre",
]

# ---------------------------------------------------------------------------
# Application
# ---------------------------------------------------------------------------
APP_ENV = os.environ.get("APP_ENV", "development")
IS_PRODUCTION = APP_ENV == "production"

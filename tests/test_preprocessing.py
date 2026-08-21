"""
Unit Tests for MusicLens Ingestion, Cleaning & Statistical Modules
==================================================================
Tests data integrity, missing value removal, date normalization, domain bounds,
and statistical computation functions.
"""

import unittest
import sys
from pathlib import Path
import pandas as pd
import numpy as np

# Add project root to sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import importlib
clean_module = importlib.import_module("pipeline.02_clean_data")
clean_and_preprocess = clean_module.clean_and_preprocess
FEATURE_BOUNDS = clean_module.FEATURE_BOUNDS

from pipeline.config import CLEANED_DATA_DIR, RAW_DATA_DIR, AUDIO_FEATURE_COLS
from pipeline.utils.stats import (
    compute_distribution_metrics,
    compute_correlations_with_target,
    test_genre_differences as calculate_genre_differences,
)


class TestDataPreprocessing(unittest.TestCase):
    """Test suite for data cleaning and schema transformation."""

    def setUp(self):
        """Create a representative synthetic raw dataframe."""
        self.sample_raw_df = pd.DataFrame({
            "track_id": ["track_1", "track_2", "track_3", "track_4", "track_5"],
            "track_name": ["Song One", "Song Two", "Song Three", np.nan, "Song Five "],
            "track_artist": ["Artist A", "Artist B", "Artist C", np.nan, "Artist A"],
            "track_popularity": [80, 50, 0, 90, 75],
            "track_album_id": ["alb_1", "alb_2", "alb_3", np.nan, "alb_5"],
            "track_album_name": ["Album 1", "Album 2", "Album 3", np.nan, "Album 5"],
            "track_album_release_date": ["2019-06-14", "2018", "2015-05", "2020-01-01", "2019"],
            "playlist_name": ["Pop Hits", "Rock Classics", "Pop Hits", "EDM Party", "Pop Hits"],
            "playlist_id": ["pl_1", "pl_2", "pl_1", "pl_3", "pl_1"],
            "playlist_genre": ["pop", "rock", "pop", "edm", "pop"],
            "playlist_subgenre": ["dance pop", "classic rock", "dance pop", "electro house", "dance pop"],
            "danceability": [0.75, 0.50, 0.65, 0.80, 0.70],
            "energy": [0.85, 0.90, 0.40, 0.95, 0.80],
            "key": [6, 11, 0, 7, 6],
            "loudness": [-4.5, -6.2, -12.0, -3.1, -5.0],
            "mode": [1, 0, 1, 1, 1],
            "speechiness": [0.05, 0.04, 0.08, 0.12, 0.06],
            "acousticness": [0.10, 0.02, 0.75, 0.01, 0.15],
            "instrumentalness": [0.00, 0.80, 0.00, 0.05, 0.00],
            "liveness": [0.10, 0.35, 0.12, 0.20, 0.08],
            "valence": [0.65, 0.45, 0.30, 0.80, 0.70],
            "tempo": [120.0, 140.0, 95.0, 128.0, 122.0],
            "duration_ms": [200000, 240000, 180000, 210000, 195000],
        })

    def test_missing_metadata_removal(self):
        """Ensure rows with missing track name/artist are dropped."""
        cleaned_df, metrics = clean_and_preprocess(self.sample_raw_df)
        self.assertEqual(len(cleaned_df), 4)
        self.assertEqual(metrics["dropped_missing_rows"], 1)
        self.assertFalse(cleaned_df["track_name"].isnull().any())
        self.assertFalse(cleaned_df["track_artist"].isnull().any())

    def test_release_date_standardization(self):
        """Verify incomplete dates (YYYY, YYYY-MM) are standardized."""
        cleaned_df, _ = clean_and_preprocess(self.sample_raw_df)
        # Check track_2 with '2018'
        track_2 = cleaned_df[cleaned_df["track_id"] == "track_2"].iloc[0]
        self.assertEqual(track_2["standard_release_date"], "2018-01-01")
        self.assertEqual(track_2["release_year"], 2018)
        self.assertEqual(track_2["release_decade"], "2010s")

        # Check track_3 with '2015-05'
        track_3 = cleaned_df[cleaned_df["track_id"] == "track_3"].iloc[0]
        self.assertEqual(track_3["standard_release_date"], "2015-05-01")
        self.assertEqual(track_3["release_year"], 2015)
        self.assertEqual(track_3["release_month"], 5)

    def test_text_normalization(self):
        """Verify trailing whitespaces are stripped."""
        cleaned_df, _ = clean_and_preprocess(self.sample_raw_df)
        track_5 = cleaned_df[cleaned_df["track_id"] == "track_5"].iloc[0]
        self.assertEqual(track_5["track_name"], "Song Five")  # Whitespace stripped

    def test_duration_derived_columns(self):
        """Verify duration in minutes and categorical bins."""
        cleaned_df, _ = clean_and_preprocess(self.sample_raw_df)
        self.assertIn("duration_min", cleaned_df.columns)
        self.assertIn("duration_category", cleaned_df.columns)
        self.assertAlmostEqual(cleaned_df.iloc[0]["duration_min"], 3.33, places=2)


class TestStatisticalUtilities(unittest.TestCase):
    """Test suite for statistical computation utilities."""

    def test_distribution_metrics(self):
        """Verify calculation of descriptive statistics."""
        data = pd.Series([10.0, 20.0, 30.0, 40.0, 50.0, 1000.0])  # Contains extreme outlier
        metrics = compute_distribution_metrics(data)

        self.assertEqual(metrics["count"], 6)
        self.assertAlmostEqual(metrics["median"], 35.0, places=1)
        self.assertGreater(metrics["skewness"], 1.0)  # Right-skewed
        self.assertGreater(metrics["outliers_mild_count"], 0)
        self.assertEqual(len(metrics["ci_95"]), 2)

    def test_correlations(self):
        """Verify correlation computation and output structure."""
        df = pd.DataFrame({
            "target": [10, 20, 30, 40, 50],
            "feature_pos": [1.0, 2.0, 3.0, 4.0, 5.0],    # Perfect positive r=1.0
            "feature_neg": [-1.0, -2.0, -3.0, -4.0, -5.0], # Perfect negative r=-1.0
            "feature_rand": [5, 2, 8, 1, 9]
        })
        corr_df = compute_correlations_with_target(df, ["feature_pos", "feature_neg", "feature_rand"], "target")

        self.assertEqual(len(corr_df), 3)
        pos_row = corr_df[corr_df["feature"] == "feature_pos"].iloc[0]
        self.assertEqual(pos_row["pearson_r"], 1.0)
        self.assertTrue(pos_row["pearson_significant"])

    def test_genre_difference_testing(self):
        """Verify ANOVA and Kruskal-Wallis hypothesis tests."""
        df = pd.DataFrame({
            "genre": ["pop"] * 20 + ["rock"] * 20,
            "feature": [0.8] * 20 + [0.2] * 20  # Completely separated groups
        })
        results = calculate_genre_differences(df, ["feature"], genre_col="genre")
        self.assertIn("feature", results)
        self.assertTrue(results["feature"]["anova_significant"])
        self.assertTrue(results["feature"]["kruskal_significant"])
        self.assertEqual(results["feature"]["effect_size"], "large")


class TestCleanedDataIntegrity(unittest.TestCase):
    """Test suite verifying actual exported cleaned files on disk."""

    def test_cleaned_disk_files_exist(self):
        """Ensure all expected CSV and Parquet files are present."""
        expected_files = [
            CLEANED_DATA_DIR / "spotify_songs_cleaned.csv",
            CLEANED_DATA_DIR / "spotify_songs_cleaned.parquet",
            CLEANED_DATA_DIR / "tracks.csv",
            CLEANED_DATA_DIR / "tracks.parquet",
            CLEANED_DATA_DIR / "audio_features.csv",
            CLEANED_DATA_DIR / "audio_features.parquet",
            CLEANED_DATA_DIR / "playlist_tracks.csv",
            CLEANED_DATA_DIR / "playlist_tracks.parquet",
        ]
        for f in expected_files:
            self.assertTrue(f.exists(), f"Missing file: {f}")
            self.assertGreater(f.stat().st_size, 0, f"Empty file: {f}")

    def test_referential_integrity(self):
        """Ensure relational integrity between tracks, audio_features, and playlist_tracks."""
        tracks_df = pd.read_csv(CLEANED_DATA_DIR / "tracks.csv")
        audio_df = pd.read_csv(CLEANED_DATA_DIR / "audio_features.csv")
        pt_df = pd.read_csv(CLEANED_DATA_DIR / "playlist_tracks.csv")

        # 1. Uniqueness of Primary Keys
        self.assertEqual(tracks_df["track_id"].nunique(), len(tracks_df))
        self.assertEqual(audio_df["track_id"].nunique(), len(audio_df))
        self.assertEqual(len(tracks_df), len(audio_df))

        # 2. Foreign Key alignment
        self.assertTrue(set(audio_df["track_id"]).issubset(set(tracks_df["track_id"])))
        self.assertTrue(set(pt_df["track_id"]).issubset(set(tracks_df["track_id"])))

        # 3. Audio feature domain checks
        for feat, (b_min, b_max) in FEATURE_BOUNDS.items():
            if feat in audio_df.columns:
                self.assertTrue(
                    (audio_df[feat] >= b_min).all(),
                    f"Feature {feat} contains values below minimum {b_min}"
                )
                self.assertTrue(
                    (audio_df[feat] <= b_max).all(),
                    f"Feature {feat} contains values above maximum {b_max}"
                )


if __name__ == "__main__":
    unittest.main()

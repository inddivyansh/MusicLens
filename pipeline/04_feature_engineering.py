"""
Step 4: Feature Engineering Pipeline
======================================
Transforms cleaned audio features into enriched analytical features and scaled
feature matrices for recommendations and visualization.

Outputs:
  - data/exports/enriched_tracks.csv / .parquet
  - data/exports/audio_scaler.joblib
  - data/exports/mood_distribution.json
  - data/exports/feature_ranges.json
"""

import sys
import json
import time
from pathlib import Path

# Add project root to sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import pandas as pd
import numpy as np

from pipeline.config import (
    CLEANED_DATA_DIR,
    EXPORTS_DIR,
    RECOMMENDATION_FEATURES,
)
from pipeline.utils.feature_engineering import (
    engineer_audio_features,
    AudioFeatureScaler,
)


def run_pipeline() -> None:
    print("=" * 65)
    print("  MusicLens — Feature Engineering Pipeline (Step 04)")
    print("=" * 65)
    t_start = time.time()

    # ------------------------------------------------------------------
    # 1. Load Cleaned Datasets
    # ------------------------------------------------------------------
    print("\n[Step 1] Loading cleaned data...")
    tracks_df = pd.read_csv(CLEANED_DATA_DIR / "tracks.csv")
    audio_df = pd.read_csv(CLEANED_DATA_DIR / "audio_features.csv")
    pt_df = pd.read_csv(CLEANED_DATA_DIR / "playlist_tracks.csv")
    cleaned_full = pd.read_csv(CLEANED_DATA_DIR / "spotify_songs_cleaned.csv")

    print(f"  Tracks: {len(tracks_df):,} | Audio records: {len(audio_df):,}")

    # ------------------------------------------------------------------
    # 2. Merge and Engineer Derived Features
    # ------------------------------------------------------------------
    print("\n[Step 2] Engineering derived audio features...")
    merged = tracks_df.merge(audio_df, on="track_id", how="inner")
    enriched = engineer_audio_features(merged, feature_cols=RECOMMENDATION_FEATURES)

    print("  Derived columns added:")
    for col in ["mood_quadrant", "tempo_bracket", "dance_energy_index", "acoustic_energy_balance"]:
        if col in enriched.columns:
            print(f"    • {col}")

    # ------------------------------------------------------------------
    # 3. Fit and Save Audio Feature Scaler
    # ------------------------------------------------------------------
    print("\n[Step 3] Fitting and persisting AudioFeatureScaler (StandardScaler)...")
    scaler = AudioFeatureScaler(feature_cols=RECOMMENDATION_FEATURES, scaler_type="standard")
    scaled_matrix = scaler.fit_transform(enriched)

    scaler_path = EXPORTS_DIR / "audio_scaler.joblib"
    scaler.save(str(scaler_path))
    print(f"  Scaler saved to: {scaler_path}")
    print(f"  Scaled matrix shape: {scaled_matrix.shape} (mean={scaled_matrix.mean():.2f}, std={scaled_matrix.std():.2f})")

    # ------------------------------------------------------------------
    # 4. Compute Global Feature Range & Distribution Metadata
    # ------------------------------------------------------------------
    print("\n[Step 4] Computing feature distribution summaries...")
    feature_ranges = {}
    for col in RECOMMENDATION_FEATURES:
        feature_ranges[col] = {
            "min": round(float(enriched[col].min()), 4),
            "max": round(float(enriched[col].max()), 4),
            "mean": round(float(enriched[col].mean()), 4),
            "std": round(float(enriched[col].std()), 4),
            "median": round(float(enriched[col].median()), 4),
        }

    # Mood Quadrant Distribution
    mood_counts = enriched["mood_quadrant"].value_counts()
    mood_distribution = {
        k: {
            "count": int(v),
            "percentage": round(float(v / len(enriched)) * 100.0, 2),
        }
        for k, v in mood_counts.items()
    }

    # Tempo Bracket Distribution
    tempo_counts = enriched["tempo_bracket"].value_counts()
    tempo_distribution = {
        k: {
            "count": int(v),
            "percentage": round(float(v / len(enriched)) * 100.0, 2),
        }
        for k, v in tempo_counts.items()
    }

    # ------------------------------------------------------------------
    # 5. Export Datasets & JSON Bundles
    # ------------------------------------------------------------------
    print("\n[Step 5] Exporting analytical artifacts...")
    # CSV / Parquet
    csv_out = EXPORTS_DIR / "enriched_tracks.csv"
    parquet_out = EXPORTS_DIR / "enriched_tracks.parquet"
    enriched.to_csv(csv_out, index=False)
    enriched.to_parquet(parquet_out, index=False)
    print(f"  Exported: {csv_out.name} ({csv_out.stat().st_size / 1e6:.1f} MB)")
    print(f"  Exported: {parquet_out.name} ({parquet_out.stat().st_size / 1e6:.1f} MB)")

    # JSON bundles for frontend
    json_targets = [EXPORTS_DIR]
    for target_dir in json_targets:
        target_dir.mkdir(parents=True, exist_ok=True)
        with open(target_dir / "mood_distribution.json", "w", encoding="utf-8") as f:
            json.dump(mood_distribution, f, indent=2)

        with open(target_dir / "tempo_distribution.json", "w", encoding="utf-8") as f:
            json.dump(tempo_distribution, f, indent=2)

        with open(target_dir / "feature_ranges.json", "w", encoding="utf-8") as f:
            json.dump(feature_ranges, f, indent=2)

    print("  JSON bundles written to data/exports/")

    elapsed = time.time() - t_start
    print(f"\n{'='*65}")
    print(f"  [Done] Feature engineering completed in {elapsed:.2f}s")
    print(f"{'='*65}\n")


if __name__ == "__main__":
    run_pipeline()

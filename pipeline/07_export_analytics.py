"""
Step 7: Presentation Analytics Exporter
========================================
Consolidates all analytical metrics, Power BI exports, and the frontend
search catalog index into clean, optimized JSON and CSV files.

Exports:
  - data/exports/powerbi/ (KPI metrics, genre summaries, artist leaderboards, audio profiles)
  - frontend/public/analytics/dashboard_bundle.json (compact analytics payload)
  - frontend/public/analytics/search_index.json (curated 2,500-track catalog)
"""

import sys
import json
import time
from pathlib import Path
from typing import List, Dict, Any

# Add project root to sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import pandas as pd
import numpy as np

from pipeline.config import (
    CLEANED_DATA_DIR,
    EXPORTS_DIR,
    FRONTEND_ANALYTICS_DIR,
    RECOMMENDATION_FEATURES,
)
from pipeline.utils.feature_engineering import categorize_mood, categorize_tempo


def _write_json(path: Path, payload: Any, pretty: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        if pretty:
            json.dump(payload, handle, indent=2, ensure_ascii=False)
        else:
            json.dump(payload, handle, separators=(",", ":"), ensure_ascii=False)


def run_pipeline() -> None:
    print("=" * 65)
    print("  MusicLens — Analytics & Presentation Exporter (Step 07)")
    print("=" * 65)
    t_start = time.time()

    # 1. Load Data
    print("\n[Step 1] Loading cleaned data...")
    tracks_df = pd.read_csv(CLEANED_DATA_DIR / "tracks.csv")
    audio_df = pd.read_csv(CLEANED_DATA_DIR / "audio_features.csv")
    pt_df = pd.read_csv(CLEANED_DATA_DIR / "playlist_tracks.csv")
    cleaned_full = pd.read_csv(CLEANED_DATA_DIR / "spotify_songs_cleaned.csv")

    merged = tracks_df.merge(audio_df, on="track_id", how="inner")
    
    # 2. Power BI Export Directory
    pbi_dir = EXPORTS_DIR / "powerbi"
    pbi_dir.mkdir(parents=True, exist_ok=True)
    FRONTEND_ANALYTICS_DIR.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------
    # 3. Compute High-Level KPIs
    # ------------------------------------------------------------------
    print("\n[Step 2] Computing catalog KPIs...")
    kpis = {
        "total_unique_tracks": int(len(tracks_df)),
        "total_playlist_appearances": int(len(pt_df)),
        "total_unique_artists": int(tracks_df["track_artist"].nunique()),
        "total_unique_albums": int(tracks_df["track_album_id"].dropna().nunique()),
        "total_macro_genres": int(pt_df["playlist_genre"].nunique()),
        "total_subgenres": int(pt_df["playlist_subgenre"].nunique()),
        "catalog_avg_popularity": round(float(tracks_df["track_popularity"].mean()), 2),
        "catalog_median_popularity": round(float(tracks_df["track_popularity"].median()), 2),
        "catalog_avg_energy_pct": round(float(audio_df["energy"].mean()) * 100.0, 1),
        "catalog_avg_danceability_pct": round(float(audio_df["danceability"].mean()) * 100.0, 1),
        "catalog_avg_valence_pct": round(float(audio_df["valence"].mean()) * 100.0, 1),
        "catalog_avg_acousticness_pct": round(float(audio_df["acousticness"].mean()) * 100.0, 1),
        "catalog_avg_tempo_bpm": round(float(audio_df["tempo"].mean()), 1),
        "catalog_avg_duration_min": round(float(tracks_df["duration_ms"].mean() / 60000.0), 2),
        "year_min": int(tracks_df["release_year"].dropna().min()) if "release_year" in tracks_df else 1957,
        "year_max": int(tracks_df["release_year"].dropna().max()) if "release_year" in tracks_df else 2020,
    }

    # ------------------------------------------------------------------
    # 4. Genre Summaries & Deep-Dive Table
    # ------------------------------------------------------------------
    print("\n[Step 3] Building genre audio profiles & metrics...")
    genre_merged = pt_df.merge(merged, on="track_id", how="inner")
    
    genre_rows = []
    for g, grp in genre_merged.groupby("playlist_genre"):
        unique_cnt = grp["track_id"].nunique()
        total_cnt = len(grp)
        pop_mean = grp["track_popularity"].mean()
        pop_std = grp["track_popularity"].std()
        ci_err = 1.96 * (pop_std / np.sqrt(total_cnt)) if total_cnt > 1 else 0

        genre_rows.append({
            "genre": g,
            "unique_tracks": int(unique_cnt),
            "playlist_appearances": int(total_cnt),
            "pct_of_catalog": round(float(unique_cnt / len(tracks_df)) * 100.0, 2),
            "avg_popularity": round(float(pop_mean), 2),
            "median_popularity": round(float(grp["track_popularity"].median()), 2),
            "std_popularity": round(float(pop_std), 2),
            "ci_95_lower": round(float(pop_mean - ci_err), 2),
            "ci_95_upper": round(float(pop_mean + ci_err), 2),
            "avg_danceability": round(float(grp["danceability"].mean()), 3),
            "avg_energy": round(float(grp["energy"].mean()), 3),
            "avg_loudness": round(float(grp["loudness"].mean()), 2),
            "avg_speechiness": round(float(grp["speechiness"].mean()), 3),
            "avg_acousticness": round(float(grp["acousticness"].mean()), 3),
            "avg_instrumentalness": round(float(grp["instrumentalness"].mean()), 3),
            "avg_liveness": round(float(grp["liveness"].mean()), 3),
            "avg_valence": round(float(grp["valence"].mean()), 3),
            "avg_tempo": round(float(grp["tempo"].mean()), 1),
        })

    genre_df = pd.DataFrame(genre_rows).sort_values("unique_tracks", ascending=False)
    genre_df.to_csv(pbi_dir / "pbi_genre_summary.csv", index=False)

    # Subgenre level breakdown
    subgenre_rows = []
    for (g, sg), grp in genre_merged.groupby(["playlist_genre", "playlist_subgenre"]):
        subgenre_rows.append({
            "genre": g,
            "subgenre": sg,
            "tracks": int(grp["track_id"].nunique()),
            "avg_popularity": round(float(grp["track_popularity"].mean()), 2),
            "avg_danceability": round(float(grp["danceability"].mean()), 3),
            "avg_energy": round(float(grp["energy"].mean()), 3),
            "avg_valence": round(float(grp["valence"].mean()), 3),
            "avg_tempo": round(float(grp["tempo"].mean()), 1),
        })
    subgenre_df = pd.DataFrame(subgenre_rows).sort_values(["genre", "tracks"], ascending=[True, False])
    subgenre_df.to_csv(pbi_dir / "pbi_subgenre_summary.csv", index=False)

    # ------------------------------------------------------------------
    # 5. Artist Leaderboard Table
    # ------------------------------------------------------------------
    print("\n[Step 4] Building artist leaderboards...")
    artist_rows = []
    for artist, grp in merged.groupby("track_artist"):
        if len(grp) >= 3:
            artist_rows.append({
                "artist": artist,
                "track_count": int(len(grp)),
                "avg_popularity": round(float(grp["track_popularity"].mean()), 1),
                "max_popularity": int(grp["track_popularity"].max()),
                "min_popularity": int(grp["track_popularity"].min()),
                "avg_danceability": round(float(grp["danceability"].mean()), 3),
                "avg_energy": round(float(grp["energy"].mean()), 3),
                "avg_valence": round(float(grp["valence"].mean()), 3),
            })
    artist_df = pd.DataFrame(artist_rows).sort_values("avg_popularity", ascending=False)
    artist_df.to_csv(pbi_dir / "pbi_artist_leaderboard.csv", index=False)

    # ------------------------------------------------------------------
    # 6. Popularity Buckets & Decade Evolution Table
    # ------------------------------------------------------------------
    print("\n[Step 5] Building popularity and temporal tables...")
    # Buckets
    bins = [-1, 0, 19, 39, 59, 79, 100]
    labels = ["00 (Zero)", "01-19 (Very Low)", "20-39 (Low)", "40-59 (Medium)", "60-79 (High)", "80-100 (Very High)"]
    merged["popularity_bucket"] = pd.cut(merged["track_popularity"], bins=bins, labels=labels)
    pop_bucket_df = (
        merged.groupby("popularity_bucket", observed=False)
        .agg(
            track_count=("track_id", "count"),
            avg_popularity=("track_popularity", "mean"),
            avg_energy=("energy", "mean"),
            avg_danceability=("danceability", "mean"),
        )
        .reset_index()
    )
    pop_bucket_df["pct_of_total"] = (pop_bucket_df["track_count"] / len(merged) * 100.0).round(2)
    pop_bucket_df.to_csv(pbi_dir / "pbi_popularity_buckets.csv", index=False)

    # Decade summary
    if "release_decade" in merged.columns:
        decade_df = (
            merged.dropna(subset=["release_decade"])
            .groupby("release_decade")
            .agg(
                track_count=("track_id", "count"),
                avg_popularity=("track_popularity", "mean"),
                avg_danceability=("danceability", "mean"),
                avg_energy=("energy", "mean"),
                avg_valence=("valence", "mean"),
                avg_tempo=("tempo", "mean"),
            )
            .reset_index()
            .sort_values("release_decade")
        )
        for c in ["avg_popularity", "avg_danceability", "avg_energy", "avg_valence", "avg_tempo"]:
            decade_df[c] = decade_df[c].round(3)
        decade_df.to_csv(pbi_dir / "pbi_decade_summary.csv", index=False)

    # ------------------------------------------------------------------
    # 7. Frontend Search Catalog Index (Top 2,000 Tracks + Full Map)
    # ------------------------------------------------------------------
    print("\n[Step 6] Building lightweight search index for frontend...")
    # Pre-map genre for each track
    track_genres = pt_df.groupby("track_id")["playlist_genre"].agg(lambda s: s.mode().iloc[0] if not s.empty else "pop").to_dict()
    merged["genre"] = merged["track_id"].map(lambda t: track_genres.get(t, "pop"))

    # Top popular songs for instant UI seed selection & searching
    feature_cols = [
        "track_id", "track_name", "track_artist", "track_album_name",
        "track_popularity", "genre", "release_year",
        "danceability", "energy", "loudness", "speechiness",
        "acousticness", "instrumentalness", "liveness", "valence", "tempo",
    ]
    top_search_catalog = (
        merged.sort_values(by=["track_popularity", "track_name"], ascending=[False, True])
        .head(2500)[feature_cols]
        .copy()
    )
    # Clean NaNs and keep numeric payloads compact
    top_search_catalog["track_album_name"] = top_search_catalog["track_album_name"].fillna("Single / Unknown Album")
    top_search_catalog["release_year"] = top_search_catalog["release_year"].fillna(2019).astype(int)
    top_search_catalog["track_popularity"] = top_search_catalog["track_popularity"].fillna(0).astype(int)
    for col in RECOMMENDATION_FEATURES:
        if col in top_search_catalog.columns:
            top_search_catalog[col] = top_search_catalog[col].fillna(0).round(4)

    search_items = top_search_catalog.to_dict(orient="records")

    # ------------------------------------------------------------------
    # 8. Save Frontend JSON Bundles
    # ------------------------------------------------------------------
    print("\n[Step 7] Exporting compact JSON bundles for the static frontend...")

    feature_ranges_path = EXPORTS_DIR / "feature_ranges.json"
    mood_path = EXPORTS_DIR / "mood_distribution.json"
    feature_ranges = {}
    mood_distribution = {}
    if feature_ranges_path.exists():
        with open(feature_ranges_path, encoding="utf-8") as handle:
            feature_ranges = json.load(handle)
        for feat, stats in feature_ranges.items():
            span = float(stats.get("max", 0) - stats.get("min", 0))
            stats["span"] = round(span, 4) if span else 1.0
    if mood_path.exists():
        with open(mood_path, encoding="utf-8") as handle:
            mood_distribution = json.load(handle)

    full_bundle = {
        "kpis": kpis,
        "genres": genre_df.to_dict(orient="records"),
        "subgenres": subgenre_df.to_dict(orient="records"),
        "top_artists": artist_df.head(30).to_dict(orient="records"),
        "popularity_buckets": json.loads(pop_bucket_df.to_json(orient="records")),
        "decade_evolution": json.loads(decade_df.to_json(orient="records")) if "release_decade" in merged.columns else [],
        "mood_distribution": mood_distribution,
        "feature_ranges": feature_ranges,
    }

    # Browser payload: two files only. All other analytics stay in data/exports/.
    _write_json(FRONTEND_ANALYTICS_DIR / "dashboard_bundle.json", full_bundle)
    _write_json(FRONTEND_ANALYTICS_DIR / "search_index.json", search_items)
    _write_json(EXPORTS_DIR / "dashboard_bundle.json", full_bundle, pretty=True)

    print(f"  Exported Power BI CSVs to: {pbi_dir}")
    print(f"  Exported frontend analytics to: {FRONTEND_ANALYTICS_DIR}")
    print(f"    dashboard_bundle.json ({(FRONTEND_ANALYTICS_DIR / 'dashboard_bundle.json').stat().st_size / 1024:.1f} KB)")
    print(f"    search_index.json ({(FRONTEND_ANALYTICS_DIR / 'search_index.json').stat().st_size / 1024:.1f} KB)")

    elapsed = time.time() - t_start
    print(f"\n{'='*65}")
    print(f"  [Done] Presentation exports completed in {elapsed:.2f}s")
    print(f"{'='*65}\n")


if __name__ == "__main__":
    run_pipeline()

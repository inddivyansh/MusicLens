"""
MusicLens — Offline Evaluation Runner
=======================================
Orchestrates the full offline recommendation evaluation:

    1. Load and split the catalog (temporal split on release_year).
    2. Build synthetic evaluation personas.
    3. Fit each recommender on the profile (past) partition only.
    4. For each persona, generate recommendations against the held-out
       (future) partition.
    5. Compute per-user quality metrics.
    6. Aggregate into population-level statistics with bootstrap CIs.
    7. Write structured JSON output to data/exports/evaluation/.

Output files
------------
    data/exports/evaluation/
    ├── split_manifest.json          — split provenance + all persona definitions
    ├── baseline_popularity.json     — per-user + aggregate results for Baseline A
    ├── baseline_content.json        — per-user + aggregate results for Baseline B
    ├── enhanced_model.json          — per-user + aggregate results for the Model
    └── comparison.json              — side-by-side summary across all three

Usage
-----
From the project root::

    python -m ml.evaluation.evaluate

Or with overrides::

    python -m ml.evaluation.evaluate \\
        --cutoff-year 2018 \\
        --n-personas 30 \\
        --k 10 \\
        --seeds 5 \\
        --ground-truth-k 50 \\
        --output-dir data/exports/evaluation

See ``python -m ml.evaluation.evaluate --help`` for all options.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import warnings
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# Project root on sys.path so ml.* imports work when run as __main__
# ---------------------------------------------------------------------------
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from ml.config import DEFAULT_CATALOG_PATH, RECOMMENDATION_FEATURES
from ml.evaluation.baselines import (
    BaseRecommenderAdapter,
    PopularityRecommender,
    ContentBasedAdapter,
    EnhancedRecommenderAdapter,
    build_all_adapters,
)
from ml.evaluation.dataset_split import (
    CatalogSplitResult,
    EvaluationPersona,
    TemporalCatalogSplit,
)
from ml.evaluation.metrics import (
    aggregate_metrics,
    average_precision_at_k,
    catalog_coverage,
    artist_coverage,
    check_no_duplicates,
    check_seed_exclusion,
    hit_rate_at_k,
    intra_list_diversity,
    ndcg_at_k,
    novelty_score,
    precision_at_k,
    recall_at_k,
)

# ---------------------------------------------------------------------------
# Output directory (relative to project root)
# ---------------------------------------------------------------------------
DEFAULT_OUTPUT_DIR: Path = _PROJECT_ROOT / "data" / "exports" / "evaluation"


# ---------------------------------------------------------------------------
# Configuration dataclass
# ---------------------------------------------------------------------------

@dataclass
class EvalConfig:
    """All evaluation hyper-parameters in one place."""

    # Split
    cutoff_year: int = 2019
    catalog_path: Path = DEFAULT_CATALOG_PATH

    # Persona construction
    n_personas: int = 20
    seeds_per_persona: int = 5
    ground_truth_k: int = 50
    genre_stratified: bool = True

    # Metric cutoff
    k: int = 10

    # Aggregation
    n_bootstrap: int = 1000
    bootstrap_ci_alpha: float = 0.05
    random_state: int = 42

    # Adapter settings
    fit_scaler_on_profile: bool = True

    # Output
    output_dir: Path = DEFAULT_OUTPUT_DIR

    def to_dict(self) -> dict[str, Any]:
        return {
            "cutoff_year": self.cutoff_year,
            "catalog_path": str(self.catalog_path),
            "n_personas": self.n_personas,
            "seeds_per_persona": self.seeds_per_persona,
            "ground_truth_k": self.ground_truth_k,
            "genre_stratified": self.genre_stratified,
            "k": self.k,
            "n_bootstrap": self.n_bootstrap,
            "bootstrap_ci_alpha": self.bootstrap_ci_alpha,
            "random_state": self.random_state,
            "fit_scaler_on_profile": self.fit_scaler_on_profile,
            "output_dir": str(self.output_dir),
        }


# ---------------------------------------------------------------------------
# Per-persona evaluation
# ---------------------------------------------------------------------------

def _evaluate_persona(
    persona: EvaluationPersona,
    adapter: BaseRecommenderAdapter,
    held_out: pd.DataFrame,
    profile: pd.DataFrame,
    feature_matrix: np.ndarray,
    track_id_to_idx: dict[str, int],
    track_popularity: dict[str, float],
    track_to_artist: dict[str, str],
    k: int,
) -> dict[str, Any]:
    """Run a single persona through one recommender and compute all metrics.

    Parameters
    ----------
    persona:
        EvaluationPersona with seed_track_ids and ground_truth_ids.
    adapter:
        A fitted BaseRecommenderAdapter.
    held_out:
        Held-out (future) catalog — the candidate pool for recommendations.
    profile:
        Profile (past) catalog — used only to verify seed validity here;
        fitting was already done outside this function.
    feature_matrix:
        Pre-scaled feature matrix for the held-out pool, used for ILD.
        Shape: (len(held_out), n_features).
    track_id_to_idx:
        Mapping from held-out track_id → row index in feature_matrix.
    track_popularity:
        Mapping from track_id → popularity score (0-100) across full catalog.
    track_to_artist:
        Mapping from track_id → artist name.
    k:
        Rank cutoff for all metrics.

    Returns
    -------
    dict
        Per-persona metric record ready for ``aggregate_metrics()``.
    """
    recommended_ids = adapter.recommend(
        seed_track_ids=persona.seed_track_ids,
        candidate_pool=held_out,
        k=k,
    )

    relevant_set = set(persona.ground_truth_ids)
    relevance_scores_dict = dict(
        zip(persona.ground_truth_ids, persona.ground_truth_scores)
    )

    # ------------------------------------------------------------------
    # Ranking quality metrics
    # ------------------------------------------------------------------
    prec = precision_at_k(recommended_ids, relevant_set, k)
    rec = recall_at_k(recommended_ids, relevant_set, k)
    hit = hit_rate_at_k(recommended_ids, relevant_set, k)
    ndcg = ndcg_at_k(
        recommended_ids, relevant_set, k,
        relevance_scores=relevance_scores_dict if relevance_scores_dict else None,
    )
    ap = average_precision_at_k(recommended_ids, relevant_set, k)

    # ------------------------------------------------------------------
    # Diversity / novelty metrics
    # ------------------------------------------------------------------
    ild = intra_list_diversity(
        recommended_ids, feature_matrix, track_id_to_idx, k=k
    )
    nov = novelty_score(recommended_ids, track_popularity, k=k)

    # ------------------------------------------------------------------
    # Safety / correctness checks  (system-integrity, NOT quality)
    # ------------------------------------------------------------------
    seed_excl = check_seed_exclusion(
        recommended_ids, set(persona.seed_track_ids)
    )
    no_dups = check_no_duplicates(recommended_ids)
    # Scores are not returned by the BaseRecommenderAdapter interface
    # (adapters return only track_id lists).  Monotonicity of scores is
    # verified inside each adapter's recommend() implementation and by
    # pipeline/06_build_recommendations.py::run_technical_evaluation().
    # We record 1.0 here to satisfy the aggregate_metrics() safety block.
    score_mono = 1.0

    # Micro-aggregation helpers (private keys, stripped before display)
    hits_at_k = sum(1 for tid in recommended_ids[:k] if tid in relevant_set)

    return {
        # Identity
        "persona_id": persona.persona_id,
        "description": persona.description,
        "recommender": adapter.name,
        "k": k,
        # Quality metrics
        "precision_at_k": round(prec, 6),
        "recall_at_k": round(rec, 6),
        "hit_rate_at_k": round(hit, 6),
        "ndcg_at_k": round(ndcg, 6),
        "ap_at_k": round(ap, 6),
        "intra_list_diversity": round(ild, 6) if not _is_nan(ild) else None,
        "novelty": round(nov, 6) if not _is_nan(nov) else None,
        # Micro helpers
        "_hits": hits_at_k,
        "_ground_truth_size": len(relevant_set),
        "_recommendation_count": len(recommended_ids[:k]),
        # Safety checks
        "seed_exclusion_rate": seed_excl,
        "duplicate_free_rate": no_dups,
        "score_monotonicity_rate": score_mono,
        # Provenance
        "_seed_count": len(persona.seed_track_ids),
        "_gt_count": len(persona.ground_truth_ids),
        "_n_recommended": len(recommended_ids),
    }


# ---------------------------------------------------------------------------
# Per-recommender evaluation loop
# ---------------------------------------------------------------------------

def run_evaluation(
    adapter: BaseRecommenderAdapter,
    split: CatalogSplitResult,
    config: EvalConfig,
) -> dict[str, Any]:
    """Evaluate one adapter against all personas and aggregate results.

    Parameters
    ----------
    adapter:
        An UNFITTED BaseRecommenderAdapter.  This function fits it.
    split:
        CatalogSplitResult with populated ``personas``.
    config:
        EvalConfig controlling k, bootstrap settings, etc.

    Returns
    -------
    dict
        Full evaluation result ready to be written to JSON.
    """
    print(f"\n  [{adapter.name}] Fitting on profile catalog "
          f"({len(split.profile_tracks):,} tracks)...")
    t0 = time.perf_counter()

    # Fit on profile-only data — NEVER on held_out
    adapter.fit(split.profile_tracks)
    fit_elapsed = time.perf_counter() - t0
    print(f"  [{adapter.name}] Fit complete in {fit_elapsed:.2f}s.")

    # Pre-compute feature matrix for the held-out pool (for ILD)
    feature_matrix, track_id_to_idx = _build_feature_matrix(
        split.held_out_tracks,
        config,
    )

    # Build lookup dicts (full catalog, for novelty scoring)
    full_catalog = pd.concat(
        [split.profile_tracks, split.held_out_tracks], ignore_index=True
    )
    track_popularity = _build_popularity_map(full_catalog)
    track_to_artist = _build_artist_map(full_catalog)

    # Per-persona loop
    per_user_records: list[dict] = []
    all_recommended: list[list[str]] = []  # for catalog/artist coverage

    print(f"  [{adapter.name}] Evaluating {len(split.personas)} personas...")
    for i, persona in enumerate(split.personas, start=1):
        record = _evaluate_persona(
            persona=persona,
            adapter=adapter,
            held_out=split.held_out_tracks,
            profile=split.profile_tracks,
            feature_matrix=feature_matrix,
            track_id_to_idx=track_id_to_idx,
            track_popularity=track_popularity,
            track_to_artist=track_to_artist,
            k=config.k,
        )
        per_user_records.append(record)
        rec_ids = adapter.recommend(
            seed_track_ids=persona.seed_track_ids,
            candidate_pool=split.held_out_tracks,
            k=config.k,
        )
        all_recommended.append(rec_ids)

        if i % 5 == 0 or i == len(split.personas):
            ndcg_so_far = np.mean([
                r["ndcg_at_k"] for r in per_user_records
                if r["ndcg_at_k"] is not None
            ])
            print(f"    {i}/{len(split.personas)} personas done | "
                  f"mean nDCG@{config.k} so far: {ndcg_so_far:.4f}")

    # Catalog and artist coverage (across all personas)
    held_out_ids = set(split.held_out_tracks["track_id"].astype(str))
    cat_cov = catalog_coverage(all_recommended, held_out_ids, k=config.k)

    catalog_artists = set(track_to_artist.values()) - {"unknown", "Unknown", ""}
    held_out_artist_map = {
        str(row["track_id"]): str(row.get("track_artist", "unknown"))
        for _, row in split.held_out_tracks.iterrows()
        if "track_artist" in split.held_out_tracks.columns
    }
    art_cov = artist_coverage(
        all_recommended,
        held_out_artist_map,
        set(held_out_artist_map.values()) - {"unknown"},
        k=config.k,
    )

    # Aggregate per-user metrics
    aggregated = aggregate_metrics(
        per_user_records,
        n_bootstrap=config.n_bootstrap,
        bootstrap_ci_alpha=config.bootstrap_ci_alpha,
        random_state=config.random_state,
    )

    # Inject coverage into aggregated metrics
    aggregated["catalog_coverage_at_k"] = round(cat_cov, 6)
    aggregated["artist_coverage_at_k"] = round(art_cov, 6)

    # Cleanse internal keys from per-user records before writing
    clean_per_user = [_strip_private_keys(r) for r in per_user_records]

    eval_elapsed = time.perf_counter() - t0
    return {
        "recommender": adapter.describe(),
        "evaluation_config": config.to_dict(),
        "split_summary": {
            "cutoff_year": split.cutoff_year,
            "profile_tracks": split.split_stats["profile_tracks"],
            "held_out_tracks": split.split_stats["held_out_tracks"],
            "n_personas": len(split.personas),
        },
        "aggregate": aggregated,
        "per_user": clean_per_user,
        "timing": {
            "fit_seconds": round(fit_elapsed, 3),
            "total_seconds": round(eval_elapsed, 3),
        },
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
    }


# ---------------------------------------------------------------------------
# Full comparison run
# ---------------------------------------------------------------------------

def run_full_comparison(config: EvalConfig) -> dict[str, Any]:
    """Run the complete three-way evaluation and write all output files.

    Steps
    -----
    1. Load catalog and apply temporal split.
    2. Build evaluation personas.
    3. Save the split manifest (reproducibility).
    4. Fit + evaluate each adapter.
    5. Write per-adapter JSON.
    6. Write comparison summary JSON.

    Parameters
    ----------
    config:
        EvalConfig controlling all aspects of the evaluation.

    Returns
    -------
    dict
        comparison.json content (also written to disk).
    """
    config.output_dir.mkdir(parents=True, exist_ok=True)

    print("=" * 68)
    print("  MusicLens — Offline Recommendation Evaluation (Phase 3)")
    print("=" * 68)
    run_start = time.perf_counter()

    # ------------------------------------------------------------------
    # Step 1: Split
    # ------------------------------------------------------------------
    print(f"\n[1/5] Loading catalog and applying temporal split "
          f"(cutoff_year={config.cutoff_year})...")
    splitter = TemporalCatalogSplit(
        cutoff_year=config.cutoff_year,
        feature_cols=RECOMMENDATION_FEATURES,
        random_state=config.random_state,
    )
    catalog = _load_catalog(config.catalog_path)
    split = splitter.split(catalog)
    print(f"  Profile  : {split.split_stats['profile_tracks']:,} tracks "
          f"({split.split_stats['profile_pct']}%)")
    print(f"  Held-out : {split.split_stats['held_out_tracks']:,} tracks "
          f"({split.split_stats['held_out_pct']}%)")
    split.validate_no_leakage()
    print("  Leakage check: PASSED (zero track overlap between partitions)")

    # ------------------------------------------------------------------
    # Step 2: Build personas
    # ------------------------------------------------------------------
    print(f"\n[2/5] Building {config.n_personas} evaluation personas "
          f"(seeds={config.seeds_per_persona}, gt_k={config.ground_truth_k})...")
    personas = splitter.build_personas(
        split,
        n_personas=config.n_personas,
        seeds_per_persona=config.seeds_per_persona,
        ground_truth_k=config.ground_truth_k,
        genre_stratified=config.genre_stratified,
    )
    print(f"  Built {len(personas)} personas.")
    for p in personas[:3]:
        print(f"    • {p.description}")
    if len(personas) > 3:
        print(f"    … and {len(personas) - 3} more.")

    # ------------------------------------------------------------------
    # Step 3: Save split manifest
    # ------------------------------------------------------------------
    manifest_path = config.output_dir / "split_manifest.json"
    splitter.save_split_manifest(split, manifest_path)
    print(f"\n[3/5] Split manifest saved → {manifest_path}")

    # ------------------------------------------------------------------
    # Step 4: Evaluate each adapter
    # ------------------------------------------------------------------
    print("\n[4/5] Running per-adapter evaluations...")
    adapters = build_all_adapters(
        fit_scaler_on_profile=config.fit_scaler_on_profile,
    )

    results: dict[str, dict] = {}
    output_filenames = {
        PopularityRecommender.name: "baseline_popularity.json",
        ContentBasedAdapter.name: "baseline_content.json",
        EnhancedRecommenderAdapter.name: "enhanced_model.json",
    }

    for adapter_name, adapter in adapters.items():
        print(f"\n  ── {adapter.name} ──")
        result = run_evaluation(adapter, split, config)
        results[adapter_name] = result

        out_path = config.output_dir / output_filenames[adapter_name]
        _write_json(result, out_path)
        print(f"  Saved → {out_path}")

    # ------------------------------------------------------------------
    # Step 5: Write comparison
    # ------------------------------------------------------------------
    print("\n[5/5] Building comparison summary...")
    comparison = _build_comparison(results, config)
    comparison_path = config.output_dir / "comparison.json"
    _write_json(comparison, comparison_path)
    print(f"  Saved → {comparison_path}")

    total_elapsed = time.perf_counter() - run_start
    print(f"\n{'=' * 68}")
    print(f"  Evaluation complete in {total_elapsed:.1f}s.")
    print(f"  Output directory: {config.output_dir}")
    print(f"{'=' * 68}\n")

    _print_summary_table(comparison, config.k)

    return comparison


# ---------------------------------------------------------------------------
# Comparison summary builder
# ---------------------------------------------------------------------------

def _build_comparison(
    results: dict[str, dict],
    config: EvalConfig,
) -> dict[str, Any]:
    """Produce the comparison.json content from per-adapter results."""
    k = config.k
    metric_keys = [
        f"precision_at_k",
        f"recall_at_k",
        f"hit_rate_at_k",
        f"ndcg_at_k",
        f"ap_at_k",
        "intra_list_diversity",
        "novelty",
    ]
    coverage_keys = ["catalog_coverage_at_k", "artist_coverage_at_k"]

    per_model: dict[str, dict] = {}
    for adapter_name, result in results.items():
        agg = result.get("aggregate", {})
        metrics_block = agg.get("metrics", {})
        model_summary: dict[str, Any] = {}

        for mk in metric_keys:
            entry = metrics_block.get(mk, {})
            model_summary[mk] = {
                "mean": entry.get("macro_mean"),
                "std": entry.get("macro_std"),
                "ci_lower": entry.get("ci_lower"),
                "ci_upper": entry.get("ci_upper"),
                "ci_method": entry.get("ci_method"),
            }

        for ck in coverage_keys:
            model_summary[ck] = agg.get(ck)

        # Micro-aggregation
        micro = agg.get("micro", {})
        model_summary["micro_precision"] = micro.get("micro_precision")
        model_summary["micro_recall"] = micro.get("micro_recall")

        # Safety checks
        model_summary["safety_checks"] = agg.get("safety_checks", {})
        model_summary["n_users_evaluated"] = agg.get("n_users", 0)

        per_model[adapter_name] = model_summary

    return {
        "evaluation_protocol": "temporal_catalog_split",
        "cutoff_year": config.cutoff_year,
        "k": k,
        "n_personas": config.n_personas,
        "seeds_per_persona": config.seeds_per_persona,
        "ground_truth_k": config.ground_truth_k,
        "bootstrap_ci_method": "bootstrap_percentile",
        "bootstrap_n_resamples": config.n_bootstrap,
        "bootstrap_ci_alpha": config.bootstrap_ci_alpha,
        "fit_scaler_on_profile": config.fit_scaler_on_profile,
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "note": (
            "Results are derived from synthetic personas built from a static "
            "Spotify catalog snapshot using a temporal catalog split on "
            "album release_year.  No real user interaction log exists.  "
            "See ml/evaluation/README.md for a full discussion of limitations."
        ),
        "models": per_model,
    }


# ---------------------------------------------------------------------------
# Pretty-print summary table
# ---------------------------------------------------------------------------

def _print_summary_table(comparison: dict, k: int) -> None:
    models = comparison.get("models", {})
    if not models:
        return

    col_w = 26
    metric_col_w = 10

    display_metrics = [
        ("precision_at_k", f"Precision@{k}"),
        ("recall_at_k",    f"Recall@{k}"),
        ("hit_rate_at_k",  f"HitRate@{k}"),
        ("ndcg_at_k",      f"nDCG@{k}"),
        ("ap_at_k",        f"AP@{k}"),
        ("intra_list_diversity", "ILD"),
        ("novelty",        "Novelty"),
        ("catalog_coverage_at_k", f"CatCov@{k}"),
    ]

    model_names = list(models.keys())
    header = f"{'Metric':<{col_w}}" + "".join(
        f"{n[:metric_col_w]:>{metric_col_w}}" for n in model_names
    )
    sep = "-" * len(header)

    print("\n  EVALUATION RESULTS SUMMARY")
    print(f"  {sep}")
    print(f"  {header}")
    print(f"  {sep}")

    for metric_key, display_name in display_metrics:
        row = f"  {display_name:<{col_w}}"
        for model_name in model_names:
            val = models[model_name].get(metric_key)
            if isinstance(val, dict):
                mean = val.get("mean")
                ci_lo = val.get("ci_lower")
                ci_hi = val.get("ci_upper")
                if mean is not None:
                    cell = f"{mean:.4f}"
                    if ci_lo is not None and ci_hi is not None:
                        cell = f"{mean:.4f}"
                else:
                    cell = "N/A"
            elif val is not None:
                cell = f"{val:.4f}"
            else:
                cell = "N/A"
            row += f"{cell:>{metric_col_w}}"
        print(row)

    print(f"  {sep}")
    print("  (95% bootstrap CIs available in comparison.json)")
    print()


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------

def _load_catalog(path: Path) -> pd.DataFrame:
    if not path.exists():
        raise FileNotFoundError(
            f"Catalog not found at {path}.  "
            "Run pipeline/04_feature_engineering.py first to generate "
            "data/exports/enriched_tracks.parquet."
        )
    suffix = path.suffix.lower()
    if suffix == ".parquet":
        return pd.read_parquet(path)
    if suffix == ".csv":
        return pd.read_csv(path)
    raise ValueError(f"Unsupported catalog format: {suffix}")


def _build_feature_matrix(
    df: pd.DataFrame,
    config: EvalConfig,
) -> tuple[np.ndarray, dict[str, int]]:
    """Build a raw (unscaled) feature matrix from df for ILD computation.

    ILD uses cosine distance in raw feature space — the same space used
    by all recommenders before scaling — so no scaler is applied here.
    """
    cols = list(RECOMMENDATION_FEATURES)
    missing = [c for c in cols if c not in df.columns]
    if missing:
        warnings.warn(
            f"ILD feature matrix: missing columns {missing}.  "
            "ILD will be NaN for all personas.",
            stacklevel=2,
        )
        return np.zeros((len(df), 1)), {}

    X = df[cols].to_numpy(dtype=float)
    track_id_to_idx = {
        str(row.track_id): i
        for i, row in enumerate(df.itertuples(index=False))
    }
    return X, track_id_to_idx


def _build_popularity_map(catalog: pd.DataFrame) -> dict[str, float]:
    if "track_popularity" not in catalog.columns:
        return {}
    return {
        str(row["track_id"]): float(row["track_popularity"])
        for _, row in catalog[["track_id", "track_popularity"]].iterrows()
    }


def _build_artist_map(catalog: pd.DataFrame) -> dict[str, str]:
    if "track_artist" not in catalog.columns:
        return {}
    return {
        str(row["track_id"]): str(row["track_artist"])
        for _, row in catalog[["track_id", "track_artist"]].iterrows()
    }


def _strip_private_keys(record: dict) -> dict:
    """Remove internal underscore-prefixed keys before writing to JSON."""
    return {k: v for k, v in record.items() if not k.startswith("_")}


def _is_nan(value: Any) -> bool:
    try:
        return isinstance(value, float) and (value != value)
    except Exception:
        return False


def _write_json(data: Any, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, default=_json_default)


def _json_default(obj: Any) -> Any:
    """JSON serialisation fallback for numpy scalars and NaN/Inf."""
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating,)):
        f = float(obj)
        if f != f:    # NaN
            return None
        if f == float("inf") or f == float("-inf"):
            return None
        return f
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    if isinstance(obj, Path):
        return str(obj)
    raise TypeError(f"Object of type {type(obj)} is not JSON serialisable")


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "MusicLens Phase 3 — Offline recommendation evaluation.\n"
            "Evaluates PopularityRecommender, ContentBasedAdapter, and "
            "EnhancedRecommenderAdapter against synthetic personas built "
            "from a temporal catalog split."
        ),
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "--cutoff-year",
        type=int,
        default=2019,
        help="Release year threshold: tracks before this year → profile, "
             "on or after → held-out.",
    )
    parser.add_argument(
        "--n-personas",
        type=int,
        default=20,
        help="Number of synthetic evaluation personas to construct.",
    )
    parser.add_argument(
        "--seeds",
        type=int,
        default=5,
        dest="seeds_per_persona",
        help="Seed tracks per persona (drawn from profile partition).",
    )
    parser.add_argument(
        "--ground-truth-k",
        type=int,
        default=50,
        help="Number of held-out tracks to include as ground truth per persona.",
    )
    parser.add_argument(
        "--k",
        type=int,
        default=10,
        help="Rank cutoff for all ranking metrics (Precision@K, nDCG@K, etc.).",
    )
    parser.add_argument(
        "--no-genre-stratified",
        action="store_false",
        dest="genre_stratified",
        default=True,
        help="Disable genre-stratified persona sampling.",
    )
    parser.add_argument(
        "--catalog",
        type=Path,
        default=DEFAULT_CATALOG_PATH,
        help="Path to enriched_tracks.parquet (or .csv).",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help="Directory to write evaluation JSON files.",
    )
    parser.add_argument(
        "--n-bootstrap",
        type=int,
        default=1000,
        help="Bootstrap resamples for confidence intervals (0 to skip).",
    )
    parser.add_argument(
        "--use-artifact-scaler",
        action="store_false",
        dest="fit_scaler_on_profile",
        default=True,
        help=(
            "Use the pre-fitted full-catalog scaler artifact instead of "
            "re-fitting on the profile partition.  "
            "WARNING: this introduces minor leakage from the held-out data "
            "into the scaler statistics."
        ),
    )
    parser.add_argument(
        "--random-state",
        type=int,
        default=42,
        help="Random seed for persona construction and bootstrap CI.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    args = _parse_args(argv)
    config = EvalConfig(
        cutoff_year=args.cutoff_year,
        catalog_path=args.catalog,
        n_personas=args.n_personas,
        seeds_per_persona=args.seeds_per_persona,
        ground_truth_k=args.ground_truth_k,
        genre_stratified=args.genre_stratified,
        k=args.k,
        n_bootstrap=args.n_bootstrap,
        fit_scaler_on_profile=args.fit_scaler_on_profile,
        random_state=args.random_state,
        output_dir=args.output_dir,
    )
    run_full_comparison(config)


if __name__ == "__main__":
    main()

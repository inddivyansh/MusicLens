"""
MusicLens — Recommendation Quality Metrics
============================================
Mathematically correct implementations of standard information-retrieval
and recommendation-system evaluation metrics.

All per-user functions operate on plain Python lists/sets so they can be
called independently of any DataFrame or model.  ``aggregate_metrics()``
rolls per-user scores into population-level statistics with optional
bootstrap confidence intervals.

Metric Definitions
------------------
Let K          = cutoff rank
    R          = set of relevant (ground-truth) items for a user
    rec_k      = ordered list of recommended items at rank 1…K

Precision@K
    |{rec_k} ∩ R| / K
    Fraction of the top-K recommendations that are relevant.

Recall@K
    |{rec_k} ∩ R| / |R|
    Fraction of all relevant items that appear in the top K.
    Capped at 1.0 when |R| = 0 (defined as 0.0 in that case).

HitRate@K  (also called Recall@K with binary per-user indicator)
    1 if |{rec_k} ∩ R| >= 1 else 0
    Whether at least one relevant item appears in the top K.

NDCG@K  (Normalised Discounted Cumulative Gain)
    Uses log-base-2 discounting.  Supports both binary relevance and
    graded relevance (when a ``relevance_scores`` dict is provided).
    Ideal DCG is computed over the |R| items with highest relevance
    truncated to K — giving a proper normalisation even when |R| < K.

MAP@K  (Mean Average Precision at K)
    Average of precision values at each rank where a hit occurs,
    divided by min(|R|, K).  Per-user AP@K is later averaged to MAP@K
    by ``aggregate_metrics()``.

Catalog Coverage@K
    |unique items recommended across all users| / |total catalog|
    Measures how broadly the recommender explores the item space.

Artist Coverage@K
    |unique artists recommended across all users| / |total artists in catalog|
    Analogous to catalog coverage at the artist level.

Intra-List Diversity (ILD)
    Mean pairwise cosine DISTANCE (1 - cosine_similarity) between
    audio feature vectors of items in a recommendation list.
    Measures how varied a single recommendation list is.
    Range [0, 1]; higher = more diverse.

Novelty@K
    Mean self-information of recommended items:
        novelty = (1/K) * sum_i  -log2( popularity_i / max_popularity )
    where popularity_i is a track's catalog popularity (0-100 Spotify score).
    Higher = more novel / less popular on average.
    Items with popularity = 0 receive a novelty score of log2(max_popularity)
    (i.e. maximally novel).

Correctness / Safety Checks
----------------------------
These are preserved from the existing evaluation but are explicitly
classified as system-integrity checks, NOT quality metrics:
    - seed_exclusion_rate      : fraction of recs that correctly exclude seeds
    - duplicate_free_rate      : fraction of lists with zero duplicate IDs
    - score_monotonicity_rate  : fraction of lists with non-increasing scores
These are computed in ``aggregate_metrics()`` when the necessary inputs
are provided and appear in a dedicated ``safety_checks`` block in output.
"""

from __future__ import annotations

import math
import warnings
from typing import Sequence

import numpy as np


# ---------------------------------------------------------------------------
# Per-user ranking metrics
# ---------------------------------------------------------------------------

def precision_at_k(
    recommended: Sequence[str],
    relevant: set[str],
    k: int,
) -> float:
    """Fraction of the top-K recommended items that are relevant.

    Parameters
    ----------
    recommended:
        Ordered list of recommended track IDs (position 0 = rank 1).
    relevant:
        Set of ground-truth relevant track IDs for this user.
    k:
        Rank cutoff.

    Returns
    -------
    float in [0.0, 1.0]
    """
    if k <= 0:
        raise ValueError(f"k must be a positive integer, got {k}.")
    if not relevant:
        return 0.0
    top_k = recommended[:k]
    hits = sum(1 for item in top_k if item in relevant)
    return hits / k


def recall_at_k(
    recommended: Sequence[str],
    relevant: set[str],
    k: int,
) -> float:
    """Fraction of all relevant items that appear in the top K.

    Returns 0.0 when ``relevant`` is empty (undefined recall is set to 0,
    not 1, to avoid inflating average recall in sparse evaluation sets).

    Parameters
    ----------
    recommended:
        Ordered list of recommended track IDs.
    relevant:
        Set of ground-truth relevant track IDs.
    k:
        Rank cutoff.

    Returns
    -------
    float in [0.0, 1.0]
    """
    if k <= 0:
        raise ValueError(f"k must be a positive integer, got {k}.")
    if not relevant:
        return 0.0
    top_k = recommended[:k]
    hits = sum(1 for item in top_k if item in relevant)
    return hits / len(relevant)


def hit_rate_at_k(
    recommended: Sequence[str],
    relevant: set[str],
    k: int,
) -> float:
    """Binary indicator: 1.0 if at least one relevant item is in the top K.

    Parameters
    ----------
    recommended:
        Ordered list of recommended track IDs.
    relevant:
        Set of ground-truth relevant track IDs.
    k:
        Rank cutoff.

    Returns
    -------
    1.0 or 0.0
    """
    if k <= 0:
        raise ValueError(f"k must be a positive integer, got {k}.")
    if not relevant:
        return 0.0
    top_k = recommended[:k]
    return 1.0 if any(item in relevant for item in top_k) else 0.0


def ndcg_at_k(
    recommended: Sequence[str],
    relevant: set[str],
    k: int,
    relevance_scores: dict[str, float] | None = None,
) -> float:
    """Normalised Discounted Cumulative Gain at K.

    Supports binary and graded relevance.

    Parameters
    ----------
    recommended:
        Ordered list of recommended track IDs (position 0 = rank 1).
    relevant:
        Set of ground-truth relevant track IDs.
    k:
        Rank cutoff.
    relevance_scores:
        Optional dict mapping track_id → graded relevance score (e.g.
        cosine similarity in [0, 1]).  When provided, DCG uses these
        scores instead of binary {0, 1} relevance.  Items in ``relevant``
        that are missing from this dict fall back to binary relevance 1.0.

    Returns
    -------
    float in [0.0, 1.0]

    Notes
    -----
    Ideal DCG is computed over the top-K items in ``relevant`` ranked by
    their relevance score (or all of ``relevant`` if |R| <= K), giving a
    correct normalisation constant whether |R| is smaller or larger than K.
    """
    if k <= 0:
        raise ValueError(f"k must be a positive integer, got {k}.")
    if not relevant:
        return 0.0

    top_k = recommended[:k]

    def _rel(item: str) -> float:
        if item not in relevant:
            return 0.0
        if relevance_scores is not None:
            return float(relevance_scores.get(item, 1.0))
        return 1.0

    # DCG
    dcg = sum(
        _rel(item) / math.log2(rank + 2)  # rank+2 because rank is 0-indexed
        for rank, item in enumerate(top_k)
    )

    # Ideal DCG — sort all relevant items by descending relevance, take top K
    if relevance_scores is not None:
        ideal_rels = sorted(
            [relevance_scores.get(item, 1.0) for item in relevant],
            reverse=True,
        )[:k]
    else:
        # Binary: all relevant items have score 1.0
        ideal_rels = [1.0] * min(len(relevant), k)

    idcg = sum(
        score / math.log2(rank + 2)
        for rank, score in enumerate(ideal_rels)
    )

    if idcg == 0.0:
        return 0.0
    return dcg / idcg


def average_precision_at_k(
    recommended: Sequence[str],
    relevant: set[str],
    k: int,
) -> float:
    """Per-user Average Precision at K (AP@K).

    AP@K = (1 / min(|R|, K)) * sum_{i=1}^{K} Precision@i * rel(i)

    where rel(i) = 1 if the item at rank i is relevant, else 0.

    Parameters
    ----------
    recommended:
        Ordered list of recommended track IDs.
    relevant:
        Set of ground-truth relevant track IDs.
    k:
        Rank cutoff.

    Returns
    -------
    float in [0.0, 1.0]
    """
    if k <= 0:
        raise ValueError(f"k must be a positive integer, got {k}.")
    if not relevant:
        return 0.0

    top_k = recommended[:k]
    hits = 0
    precision_sum = 0.0
    for rank, item in enumerate(top_k, start=1):
        if item in relevant:
            hits += 1
            precision_sum += hits / rank

    normaliser = min(len(relevant), k)
    return precision_sum / normaliser if normaliser > 0 else 0.0


def map_at_k(
    all_recommended: list[Sequence[str]],
    all_relevant: list[set[str]],
    k: int,
) -> float:
    """Mean Average Precision at K over a list of users.

    Parameters
    ----------
    all_recommended:
        List of per-user recommended track ID sequences.
    all_relevant:
        List of per-user ground-truth sets, aligned with ``all_recommended``.
    k:
        Rank cutoff.

    Returns
    -------
    float in [0.0, 1.0]
    """
    if len(all_recommended) != len(all_relevant):
        raise ValueError(
            "all_recommended and all_relevant must have the same length."
        )
    if not all_recommended:
        return 0.0
    aps = [
        average_precision_at_k(rec, rel, k)
        for rec, rel in zip(all_recommended, all_relevant)
    ]
    return float(np.mean(aps))


# ---------------------------------------------------------------------------
# Catalog-level / aggregate diversity metrics
# ---------------------------------------------------------------------------

def catalog_coverage(
    all_recommended: list[Sequence[str]],
    catalog_ids: set[str],
    k: int | None = None,
) -> float:
    """Fraction of catalog items recommended to at least one user.

    Parameters
    ----------
    all_recommended:
        List of per-user recommended track ID sequences.
    catalog_ids:
        Set of all track IDs in the catalog (or the relevant partition).
    k:
        If provided, only the top-K items per user are considered.

    Returns
    -------
    float in [0.0, 1.0]
    """
    if not catalog_ids:
        return 0.0
    seen: set[str] = set()
    for rec in all_recommended:
        items = rec[:k] if k is not None else rec
        seen.update(items)
    # Only count items that actually exist in the catalog
    seen &= catalog_ids
    return len(seen) / len(catalog_ids)


def artist_coverage(
    all_recommended: list[Sequence[str]],
    track_to_artist: dict[str, str],
    catalog_artist_ids: set[str],
    k: int | None = None,
) -> float:
    """Fraction of catalog artists whose tracks are recommended to any user.

    Parameters
    ----------
    all_recommended:
        List of per-user recommended track ID sequences.
    track_to_artist:
        Mapping from track_id → artist name/ID.
    catalog_artist_ids:
        Set of all artist names/IDs present in the catalog.
    k:
        If provided, only the top-K items per user are considered.

    Returns
    -------
    float in [0.0, 1.0]
    """
    if not catalog_artist_ids:
        return 0.0
    seen_artists: set[str] = set()
    for rec in all_recommended:
        items = rec[:k] if k is not None else rec
        for track_id in items:
            artist = track_to_artist.get(track_id)
            if artist is not None:
                seen_artists.add(artist)
    seen_artists &= catalog_artist_ids
    return len(seen_artists) / len(catalog_artist_ids)


def intra_list_diversity(
    recommended: Sequence[str],
    feature_matrix: np.ndarray,
    track_id_to_idx: dict[str, int],
    k: int | None = None,
) -> float:
    """Mean pairwise cosine distance between items in a recommendation list.

    ILD = (2 / (K*(K-1))) * sum_{i<j} (1 - cosine_similarity(v_i, v_j))

    A list of identical items has ILD = 0.  A perfectly diverse list of
    orthogonal feature vectors has ILD = 1.

    Parameters
    ----------
    recommended:
        Ordered list of recommended track IDs.
    feature_matrix:
        Pre-normalised feature matrix (n_tracks × n_features).
        Rows must correspond to track_id_to_idx positions.
    track_id_to_idx:
        Mapping from track_id → row index in feature_matrix.
    k:
        If provided, only the top-K items are used.

    Returns
    -------
    float in [0.0, 1.0], or NaN if fewer than 2 valid items.
    """
    items = recommended[:k] if k is not None else list(recommended)
    indices = [track_id_to_idx[tid] for tid in items if tid in track_id_to_idx]

    if len(indices) < 2:
        return float("nan")

    vectors = feature_matrix[indices]  # shape (n, d)

    # L2-normalise for correct cosine similarity via dot product
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    norms = np.where(norms == 0, 1.0, norms)
    normed = vectors / norms

    # Cosine similarity matrix via dot product
    sim_matrix = normed @ normed.T  # (n, n)

    n = len(indices)
    # Extract upper-triangle (i < j), compute distances
    i_idx, j_idx = np.triu_indices(n, k=1)
    pairwise_sims = sim_matrix[i_idx, j_idx]
    pairwise_distances = 1.0 - pairwise_sims

    return float(np.mean(pairwise_distances))


def novelty_score(
    recommended: Sequence[str],
    track_popularity: dict[str, float],
    max_popularity: float = 100.0,
    k: int | None = None,
) -> float:
    """Mean self-information of recommended items based on catalog popularity.

    novelty(i) = -log2( popularity_i / max_popularity )

    Items with popularity = 0 receive log2(max_popularity) (maximally novel).
    Popularity is the Spotify track_popularity score in [0, 100].

    A higher novelty score means the recommender surfaces less popular,
    more "surprising" content.

    Parameters
    ----------
    recommended:
        Ordered list of recommended track IDs.
    track_popularity:
        Mapping from track_id → popularity score in [0, max_popularity].
    max_popularity:
        Upper bound of the popularity scale (default 100 for Spotify).
    k:
        If provided, only the top-K items are used.

    Returns
    -------
    float >= 0.0, or NaN if no items have known popularity.
    """
    items = recommended[:k] if k is not None else list(recommended)
    scores: list[float] = []
    for tid in items:
        pop = track_popularity.get(tid)
        if pop is None:
            continue
        pop = max(0.0, min(float(pop), max_popularity))
        if pop == 0.0:
            # Maximally novel: use the limit as popularity → 0
            scores.append(math.log2(max_popularity))
        else:
            scores.append(-math.log2(pop / max_popularity))

    if not scores:
        return float("nan")
    return float(np.mean(scores))


# ---------------------------------------------------------------------------
# Population-level aggregation and reporting
# ---------------------------------------------------------------------------

def aggregate_metrics(
    per_user_records: list[dict],
    n_bootstrap: int = 1000,
    bootstrap_ci_alpha: float = 0.05,
    random_state: int = 42,
) -> dict:
    """Aggregate per-user metric dicts into macro statistics.

    Each record in ``per_user_records`` is produced by
    ``evaluate.py::_evaluate_persona()`` and contains keys like
    ``precision_at_k``, ``recall_at_k``, etc.

    Parameters
    ----------
    per_user_records:
        List of per-user result dicts.  Keys that map to float values are
        aggregated; non-numeric keys are ignored.
    n_bootstrap:
        Number of bootstrap resamples for confidence intervals.
        Set to 0 to skip CI computation.
    bootstrap_ci_alpha:
        Two-tailed alpha for CI bounds (default 0.05 → 95 % CI).
    random_state:
        Seed for reproducible bootstrap sampling.

    Returns
    -------
    dict with structure::

        {
            "n_users": int,
            "metrics": {
                "<metric_name>": {
                    "macro_mean": float,
                    "macro_std": float,
                    "macro_median": float,
                    "macro_min": float,
                    "macro_max": float,
                    "ci_lower": float | null,    # bootstrap lower bound
                    "ci_upper": float | null,    # bootstrap upper bound
                    "ci_method": "bootstrap" | null,
                    "ci_alpha": float | null,
                    "n_valid": int,              # users with non-NaN values
                },
                ...
            },
            "micro": {
                "total_hits": int | null,
                "total_ground_truth": int | null,
                "micro_precision": float | null,
                "micro_recall": float | null,
            },
            "safety_checks": {           # preserved from existing evaluation
                "seed_exclusion_rate": float | null,
                "duplicate_free_rate": float | null,
                "score_monotonicity_rate": float | null,
            }
        }
    """
    if not per_user_records:
        return {"n_users": 0, "metrics": {}, "micro": {}, "safety_checks": {}}

    rng = np.random.default_rng(random_state)

    # Collect numeric metric columns
    all_keys = set()
    for rec in per_user_records:
        all_keys.update(rec.keys())

    # Keys that are explicitly safety checks — keep separate
    safety_keys = {
        "seed_exclusion_rate",
        "duplicate_free_rate",
        "score_monotonicity_rate",
    }
    # Keys that carry micro-aggregation data
    micro_keys = {
        "_hits",
        "_ground_truth_size",
        "_recommendation_count",
    }
    # Non-metric metadata keys
    skip_keys = {
        "persona_id",
        "description",
        "recommender",
        "k",
    } | micro_keys

    metric_keys = sorted(
        k for k in all_keys
        if k not in skip_keys
        and k not in safety_keys
        and not k.startswith("_")
    )

    metrics_out: dict[str, dict] = {}
    for key in metric_keys:
        values = []
        for rec in per_user_records:
            v = rec.get(key)
            if v is not None and not (isinstance(v, float) and math.isnan(v)):
                try:
                    values.append(float(v))
                except (TypeError, ValueError):
                    pass

        if not values:
            metrics_out[key] = {
                "macro_mean": None,
                "macro_std": None,
                "macro_median": None,
                "macro_min": None,
                "macro_max": None,
                "ci_lower": None,
                "ci_upper": None,
                "ci_method": None,
                "ci_alpha": None,
                "n_valid": 0,
            }
            continue

        arr = np.array(values, dtype=float)
        macro_mean = float(np.mean(arr))
        macro_std = float(np.std(arr, ddof=1)) if len(arr) > 1 else 0.0
        macro_median = float(np.median(arr))
        macro_min = float(np.min(arr))
        macro_max = float(np.max(arr))

        ci_lower: float | None = None
        ci_upper: float | None = None
        ci_method: str | None = None
        ci_alpha_out: float | None = None

        if n_bootstrap > 0 and len(arr) >= 5:
            # Bootstrap resampling of the mean
            boot_means = np.array([
                np.mean(rng.choice(arr, size=len(arr), replace=True))
                for _ in range(n_bootstrap)
            ])
            lower_pct = (bootstrap_ci_alpha / 2) * 100
            upper_pct = (1 - bootstrap_ci_alpha / 2) * 100
            ci_lower = float(np.percentile(boot_means, lower_pct))
            ci_upper = float(np.percentile(boot_means, upper_pct))
            ci_method = "bootstrap_percentile"
            ci_alpha_out = bootstrap_ci_alpha

        metrics_out[key] = {
            "macro_mean": round(macro_mean, 6),
            "macro_std": round(macro_std, 6),
            "macro_median": round(macro_median, 6),
            "macro_min": round(macro_min, 6),
            "macro_max": round(macro_max, 6),
            "ci_lower": round(ci_lower, 6) if ci_lower is not None else None,
            "ci_upper": round(ci_upper, 6) if ci_upper is not None else None,
            "ci_method": ci_method,
            "ci_alpha": ci_alpha_out,
            "n_valid": len(arr),
        }

    # ------------------------------------------------------------------
    # Micro-aggregation (total hits / total ground truth across all users)
    # ------------------------------------------------------------------
    total_hits = sum(r.get("_hits", 0) or 0 for r in per_user_records)
    total_gt = sum(r.get("_ground_truth_size", 0) or 0 for r in per_user_records)
    total_recs = sum(r.get("_recommendation_count", 0) or 0 for r in per_user_records)

    micro: dict = {
        "total_hits": int(total_hits),
        "total_ground_truth": int(total_gt),
        "total_recommendations": int(total_recs),
        "micro_precision": round(total_hits / total_recs, 6)
        if total_recs > 0
        else None,
        "micro_recall": round(total_hits / total_gt, 6)
        if total_gt > 0
        else None,
    }

    # ------------------------------------------------------------------
    # Safety checks (system-correctness, NOT quality metrics)
    # ------------------------------------------------------------------
    safety: dict[str, float | None] = {
        "seed_exclusion_rate": None,
        "duplicate_free_rate": None,
        "score_monotonicity_rate": None,
    }
    for sk in safety_keys:
        vals = [
            float(r[sk])
            for r in per_user_records
            if sk in r and r[sk] is not None
        ]
        if vals:
            safety[sk] = round(float(np.mean(vals)), 6)

    return {
        "n_users": len(per_user_records),
        "metrics": metrics_out,
        "micro": micro,
        "safety_checks": safety,
    }


# ---------------------------------------------------------------------------
# Correctness / safety check helpers  (system-integrity, not quality)
# ---------------------------------------------------------------------------

def check_seed_exclusion(
    recommended: Sequence[str],
    seed_ids: set[str],
) -> float:
    """Return 1.0 if no seed track appears in recommendations, else 0.0."""
    return 0.0 if any(tid in seed_ids for tid in recommended) else 1.0


def check_no_duplicates(recommended: Sequence[str]) -> float:
    """Return 1.0 if all recommended IDs are unique, else 0.0."""
    return 1.0 if len(recommended) == len(set(recommended)) else 0.0


def check_score_monotonicity(scores: Sequence[float]) -> float:
    """Return 1.0 if scores are non-increasing (weakly descending), else 0.0."""
    if len(scores) < 2:
        return 1.0
    for i in range(len(scores) - 1):
        if scores[i] < scores[i + 1]:
            return 0.0
    return 1.0

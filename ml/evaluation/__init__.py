"""
MusicLens — Offline Recommendation Evaluation Framework
=========================================================
Provides tools for evaluating recommendation quality using held-out
catalog interactions, proper temporal splits, and IR-style ranking metrics.

Public surface
--------------
dataset_split  — TemporalCatalogSplit, CatalogSplitResult
metrics        — precision_at_k, recall_at_k, hit_rate_at_k, ndcg_at_k,
                 map_at_k, catalog_coverage, artist_coverage,
                 intra_list_diversity, novelty_score, aggregate_metrics
baselines      — PopularityRecommender, ContentBasedAdapter,
                 EnhancedRecommenderAdapter
evaluate       — run_evaluation, run_full_comparison
"""

from ml.evaluation.dataset_split import TemporalCatalogSplit, CatalogSplitResult
from ml.evaluation.metrics import (
    precision_at_k,
    recall_at_k,
    hit_rate_at_k,
    ndcg_at_k,
    map_at_k,
    catalog_coverage,
    artist_coverage,
    intra_list_diversity,
    novelty_score,
    aggregate_metrics,
)
from ml.evaluation.baselines import (
    PopularityRecommender,
    ContentBasedAdapter,
    EnhancedRecommenderAdapter,
    BaseRecommenderAdapter,
)

__all__ = [
    # split
    "TemporalCatalogSplit",
    "CatalogSplitResult",
    # metrics
    "precision_at_k",
    "recall_at_k",
    "hit_rate_at_k",
    "ndcg_at_k",
    "map_at_k",
    "catalog_coverage",
    "artist_coverage",
    "intra_list_diversity",
    "novelty_score",
    "aggregate_metrics",
    # baselines
    "PopularityRecommender",
    "ContentBasedAdapter",
    "EnhancedRecommenderAdapter",
    "BaseRecommenderAdapter",
]

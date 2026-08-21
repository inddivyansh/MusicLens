"""
MusicLens Pipeline Utilities
=============================
Reusable modules for statistics, visualization, database access,
feature engineering, user profiling, and content-based recommendation.
"""

from pipeline.utils.stats import (
    compute_distribution_metrics,
    compute_correlations_with_target,
    test_genre_differences,
)
from pipeline.utils.viz import (
    plot_genre_distribution,
    plot_genre_popularity_comparison,
    plot_feature_distributions,
    plot_correlation_heatmap,
    plot_genre_radar_profile,
)
from pipeline.utils.db import get_engine, get_connection, execute_schema, fetch_all
from pipeline.utils.feature_engineering import (
    engineer_audio_features,
    categorize_mood,
    categorize_tempo,
    AudioFeatureScaler,
)
from pipeline.utils.user_profile import UserMusicProfile, determine_personality_archetype
from pipeline.utils.recommender import ContentBasedRecommender

__all__ = [
    "compute_distribution_metrics",
    "compute_correlations_with_target",
    "test_genre_differences",
    "plot_genre_distribution",
    "plot_genre_popularity_comparison",
    "plot_feature_distributions",
    "plot_correlation_heatmap",
    "plot_genre_radar_profile",
    "get_engine",
    "get_connection",
    "execute_schema",
    "fetch_all",
    "engineer_audio_features",
    "categorize_mood",
    "categorize_tempo",
    "AudioFeatureScaler",
    "UserMusicProfile",
    "determine_personality_archetype",
    "ContentBasedRecommender",
]

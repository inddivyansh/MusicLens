"""Configuration shared by MusicLens taste-model training and inference."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Final


PROJECT_ROOT: Final[Path] = Path(__file__).resolve().parent.parent
ARTIFACT_DIR: Final[Path] = PROJECT_ROOT / "ml" / "artifacts"
DEFAULT_CATALOG_PATH: Final[Path] = PROJECT_ROOT / "data" / "exports" / "enriched_tracks.parquet"
RECOMMENDATION_FEATURES: Final[tuple[str, ...]] = (
    "danceability", "energy", "loudness", "speechiness", "acousticness",
    "instrumentalness", "liveness", "valence", "tempo",
)


@dataclass(frozen=True)
class TasteAggregationConfig:
    """Tunable source and recency settings for a user taste representation.

    Equal source weights are a neutral starting point: a source's sample count
    does not silently make it more influential than another available source.
    They are persisted with the model artifact so future tuning is reproducible.
    """

    source_weights: dict[str, float] = field(default_factory=lambda: {
        "long_term": 1.0,
        "recent": 1.0,
        "liked": 1.0,
    })
    temporal_decay_lambda_per_day: float = 0.08
    frequency_cap: int = 10
    source_precedence: tuple[str, ...] = ("liked", "recent", "long_term")
    decay_sources: tuple[str, ...] = ("recent",)

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass(frozen=True)
class TasteModelConfig:
    """Deterministic catalog representation-learning settings."""

    feature_columns: tuple[str, ...] = RECOMMENDATION_FEATURES
    explained_variance_threshold: float = 0.95
    random_state: int = 42
    aggregation: TasteAggregationConfig = field(default_factory=TasteAggregationConfig)

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


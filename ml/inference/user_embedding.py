"""Create deterministic user embeddings from source-aware taste signals."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Iterable

from ml.config import ARTIFACT_DIR, TasteAggregationConfig
from ml.features import TasteSignal, build_user_taste_representation
from ml.models import TasteEmbeddingModel


def create_user_embedding(
    signals: Iterable[TasteSignal],
    model_path: Path = ARTIFACT_DIR / "taste_model.joblib",
    aggregation_config: TasteAggregationConfig | None = None,
    now: datetime | None = None,
) -> dict[str, object] | None:
    """Return raw/source metadata and a PCA embedding using persisted artifacts."""

    representation = build_user_taste_representation(
        signals,
        aggregation_config or TasteAggregationConfig(),
        now=now,
    )
    if representation is None:
        return None
    model = TasteEmbeddingModel.load(model_path)
    payload = representation.as_dict()
    payload["embedding"] = model.transform(representation.raw_vector).round(10).tolist()[0]
    return payload


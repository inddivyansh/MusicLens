"""Source-aware, time-aware aggregation of track audio features."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from math import exp
from typing import Any, Iterable, Mapping

import numpy as np

from ml.config import RECOMMENDATION_FEATURES, TasteAggregationConfig


SOURCE_TO_GROUP = {
    "top_tracks": "long_term",
    "recently_played": "recent",
    "liked_songs": "liked",
    "manual": "liked",
}


@dataclass(frozen=True)
class TasteSignal:
    """One resolved track interaction, with an optional timestamp and count."""

    track_id: str
    source: str
    features: Mapping[str, float]
    occurred_at: datetime | None = None
    interaction_count: int = 1


@dataclass(frozen=True)
class UserTasteRepresentation:
    """Raw profile plus transparent source/sample-size metadata."""

    raw_vector: np.ndarray
    source_profiles: dict[str, dict[str, Any]]
    metadata: dict[str, Any]

    def as_dict(self) -> dict[str, Any]:
        return {
            "raw_vector": self.raw_vector.round(10).tolist(),
            "source_profiles": self.source_profiles,
            "metadata": self.metadata,
        }


def _parse_timestamp(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _group_for_source(source: str) -> str:
    return SOURCE_TO_GROUP.get(source, "long_term")


def _valid_vector(features: Mapping[str, float]) -> np.ndarray | None:
    try:
        vector = np.asarray([float(features[name]) for name in RECOMMENDATION_FEATURES], dtype=float)
    except (KeyError, TypeError, ValueError):
        return None
    return vector if np.isfinite(vector).all() else None


def _deduplicate_by_track(signals: Iterable[TasteSignal], config: TasteAggregationConfig) -> list[TasteSignal]:
    """Keep one source per track, preventing overlap across Spotify endpoints.

    A saved/liked signal takes precedence over a recent play, which takes
    precedence over a top-track appearance. This preserves explicit intent
    without adding weight solely because the same track appeared in several
    Spotify lists.
    """

    priority = {source: index for index, source in enumerate(config.source_precedence)}
    selected: dict[str, TasteSignal] = {}
    for signal in signals:
        if not signal.track_id:
            continue
        group = _group_for_source(signal.source)
        existing = selected.get(signal.track_id)
        if existing is None:
            selected[signal.track_id] = signal
            continue
        current_priority = priority.get(group, len(priority))
        existing_priority = priority.get(_group_for_source(existing.source), len(priority))
        if current_priority < existing_priority:
            selected[signal.track_id] = signal
    return list(selected.values())


def build_user_taste_representation(
    signals: Iterable[TasteSignal],
    config: TasteAggregationConfig,
    now: datetime | None = None,
) -> UserTasteRepresentation | None:
    """Build a configurable profile from long-term, recent, and liked signals.

    Missing timestamps receive a neutral temporal multiplier of 1.0 rather
    than being dropped or treated as newly played. Frequency only changes a
    track's within-source contribution and is capped by configuration.
    """

    reference_time = _parse_timestamp(now) or datetime.now(timezone.utc)
    grouped: dict[str, list[tuple[np.ndarray, float, TasteSignal, float]]] = {
        "long_term": [], "recent": [], "liked": [],
    }
    for signal in _deduplicate_by_track(signals, config):
        vector = _valid_vector(signal.features)
        if vector is None:
            continue
        group = _group_for_source(signal.source)
        occurred_at = _parse_timestamp(signal.occurred_at)
        decay_weight = 1.0
        if group in config.decay_sources and occurred_at is not None:
            age_days = max(0.0, (reference_time - occurred_at).total_seconds() / 86400.0)
            decay_weight = exp(-config.temporal_decay_lambda_per_day * age_days)
        frequency_weight = min(max(int(signal.interaction_count or 1), 1), config.frequency_cap)
        grouped[group].append((vector, decay_weight * frequency_weight, signal, decay_weight))

    source_profiles: dict[str, dict[str, Any]] = {}
    active_vectors: list[tuple[np.ndarray, float]] = []
    for group, entries in grouped.items():
        if not entries:
            continue
        weights = np.asarray([entry[1] for entry in entries], dtype=float)
        matrix = np.vstack([entry[0] for entry in entries])
        profile = np.average(matrix, axis=0, weights=weights)
        source_weight = float(config.source_weights.get(group, 0.0))
        source_profiles[group] = {
            "raw_vector": profile.round(10).tolist(),
            "unique_tracks": len(entries),
            "effective_track_weight": float(weights.sum()),
            "source_weight": source_weight,
            "mean_temporal_weight": float(np.mean([entry[3] for entry in entries])),
        }
        if source_weight > 0:
            active_vectors.append((profile, source_weight))

    if not active_vectors:
        return None

    profile_matrix = np.vstack([entry[0] for entry in active_vectors])
    source_weights = np.asarray([entry[1] for entry in active_vectors], dtype=float)
    raw_vector = np.average(profile_matrix, axis=0, weights=source_weights)
    source_counts = {group: details["unique_tracks"] for group, details in source_profiles.items()}
    return UserTasteRepresentation(
        raw_vector=raw_vector,
        source_profiles=source_profiles,
        metadata={
            "unique_tracks": int(sum(source_counts.values())),
            "recent_tracks": int(source_counts.get("recent", 0)),
            "liked_tracks": int(source_counts.get("liked", 0)),
            "long_term_tracks": int(source_counts.get("long_term", 0)),
            "profile_sample_size": int(sum(source_counts.values())),
            "source_contributions": source_counts,
            "deduplication": "one source per track using liked > recent > long_term precedence",
        },
    )


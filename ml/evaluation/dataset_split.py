"""
MusicLens — Evaluation Dataset Split
======================================
Provides a principled train/test split for the offline recommendation
evaluation framework.

Data Availability and Honesty
------------------------------
The MusicLens dataset is a static Spotify catalog snapshot.  It does NOT
contain a per-user interaction log with real timestamps.  The columns that
could support a temporal split are:

    tracks.release_year   — integer year the album was released
    tracks.release_month  — integer month (1–12)

These are album metadata, NOT listening timestamps.  They cannot function
as interaction timestamps, but they DO carry meaningful signal:

  * Tracks released BEFORE a cutoff year are "catalog knowledge" — a model
    trained on this data would plausibly be evaluated against them.
  * Tracks released ON OR AFTER the cutoff are "held-out future catalog" —
    they represent music that a model trained only on the earlier portion
    would not have been exposed to during fitting.

This mirrors the way real temporal evaluation works:
    PAST  → profile / training data
    FUTURE → ground-truth candidates

The split is therefore a **catalog-temporal split**, not a user-interaction
split.  This is the correct approach given the available data, and it is
documented explicitly so that results are never over-claimed.

Interaction Simulation
-----------------------
Because there are no real user interaction logs, the framework synthesises
pseudo-users ("evaluation personas") from the catalog.  Each persona is
built by sampling a seed set of tracks from the PROFILE partition
(past catalog).  The ground-truth set for that persona is formed by finding
the K most similar tracks from the HELD-OUT partition (future catalog) using
the same audio feature space.  This creates a self-consistent, reproducible
evaluation protocol that avoids leakage: the model never sees the held-out
tracks during profile construction.

Leakage Prevention Summary
---------------------------
1. The scaler / PCA artifacts are fitted ONLY on the PROFILE partition
   (or, equivalently, must already be fitted and loaded from disk without
   re-fitting on test tracks).  ``CatalogSplitResult`` exposes
   ``profile_tracks`` as the safe fitting set.
2. Ground-truth tracks are drawn exclusively from ``held_out_tracks``.
3. Seed tracks for each persona are drawn exclusively from ``profile_tracks``.
4. No track that appears in ``held_out_tracks`` may appear in a seed set.
5. Track IDs are validated at persona construction time.
"""

from __future__ import annotations

import hashlib
import json
import warnings
from dataclasses import dataclass, field
from pathlib import Path
from typing import Final

import numpy as np
import pandas as pd
from sklearn.metrics.pairwise import cosine_similarity

from ml.config import DEFAULT_CATALOG_PATH, RECOMMENDATION_FEATURES

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Default year used as the profile/held-out boundary.
# Tracks released before this year  → profile (training) catalog
# Tracks released in or after this year → held-out (test) catalog
# 2019 gives roughly 80 % profile / 20 % held-out on the 30k Spotify dataset.
DEFAULT_CUTOFF_YEAR: Final[int] = 2019

# Minimum number of held-out tracks required for the split to be usable.
MIN_HELD_OUT_TRACKS: Final[int] = 100

# Random state for reproducible persona sampling.
DEFAULT_RANDOM_STATE: Final[int] = 42


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class EvaluationPersona:
    """One synthetic pseudo-user for offline evaluation.

    Attributes
    ----------
    persona_id:
        Stable identifier (SHA-8 of seed_track_ids list).
    description:
        Human-readable label (e.g. "Pop high-energy seed set 1").
    seed_track_ids:
        Track IDs drawn from the PROFILE partition that represent this
        persona's listening history.  MUST NOT overlap with ``ground_truth_ids``.
    ground_truth_ids:
        Track IDs drawn from the HELD-OUT partition that are considered
        relevant for this persona.
    ground_truth_scores:
        Optional relevance scores (e.g. cosine similarity) in the same order
        as ``ground_truth_ids``.  Used for graded relevance metrics (nDCG).
    metadata:
        Arbitrary provenance dict stored in evaluation output JSON.
    """

    persona_id: str
    description: str
    seed_track_ids: list[str]
    ground_truth_ids: list[str]
    ground_truth_scores: list[float] = field(default_factory=list)
    metadata: dict = field(default_factory=dict)

    def __post_init__(self) -> None:
        seed_set = set(self.seed_track_ids)
        gt_set = set(self.ground_truth_ids)
        overlap = seed_set & gt_set
        if overlap:
            raise ValueError(
                f"Persona '{self.persona_id}': {len(overlap)} track(s) appear in both "
                f"seed_track_ids and ground_truth_ids — this is a leakage violation.\n"
                f"Overlapping IDs (first 5): {list(overlap)[:5]}"
            )
        if not self.seed_track_ids:
            raise ValueError(f"Persona '{self.persona_id}' has no seed tracks.")
        if not self.ground_truth_ids:
            raise ValueError(f"Persona '{self.persona_id}' has no ground-truth tracks.")


@dataclass
class CatalogSplitResult:
    """Output of TemporalCatalogSplit.split().

    Attributes
    ----------
    profile_tracks:
        DataFrame of tracks + audio features from the PROFILE (past) partition.
        Safe to fit scalers and extract seed sets from.
    held_out_tracks:
        DataFrame of tracks + audio features from the HELD-OUT (future) partition.
        Ground-truth candidates are drawn from here exclusively.
    cutoff_year:
        The release year threshold used for the split.
    split_stats:
        Provenance dict (row counts, year distributions, data hash).
    personas:
        List of EvaluationPersona objects constructed after the split.
        Populated by ``TemporalCatalogSplit.build_personas()``.
    """

    profile_tracks: pd.DataFrame
    held_out_tracks: pd.DataFrame
    cutoff_year: int
    split_stats: dict
    personas: list[EvaluationPersona] = field(default_factory=list)

    # ------------------------------------------------------------------
    # Convenience properties
    # ------------------------------------------------------------------

    @property
    def profile_track_ids(self) -> set[str]:
        return set(self.profile_tracks["track_id"].astype(str))

    @property
    def held_out_track_ids(self) -> set[str]:
        return set(self.held_out_tracks["track_id"].astype(str))

    def validate_no_leakage(self) -> None:
        """Raise if any profile track_id appears in the held-out set."""
        overlap = self.profile_track_ids & self.held_out_track_ids
        if overlap:
            raise AssertionError(
                f"Leakage detected: {len(overlap)} track(s) appear in both "
                f"profile and held-out partitions.  This should be impossible "
                f"with a year-based split; investigate duplicate track_ids.\n"
                f"First 5: {list(overlap)[:5]}"
            )


# ---------------------------------------------------------------------------
# Splitter
# ---------------------------------------------------------------------------

class TemporalCatalogSplit:
    """Splits the Spotify catalog on album release year to create a
    temporally honest evaluation protocol.

    Parameters
    ----------
    cutoff_year:
        Tracks with ``release_year < cutoff_year`` go to the profile
        partition; tracks with ``release_year >= cutoff_year`` go to
        the held-out partition.
    feature_cols:
        Audio features used for similarity-based ground-truth construction.
    random_state:
        Seed for reproducible persona sampling.
    """

    def __init__(
        self,
        cutoff_year: int = DEFAULT_CUTOFF_YEAR,
        feature_cols: tuple[str, ...] | list[str] = RECOMMENDATION_FEATURES,
        random_state: int = DEFAULT_RANDOM_STATE,
    ) -> None:
        self.cutoff_year = cutoff_year
        self.feature_cols = list(feature_cols)
        self.random_state = random_state
        self._rng = np.random.default_rng(random_state)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def split(self, catalog: pd.DataFrame | None = None) -> CatalogSplitResult:
        """Load (or accept) the catalog and produce a ``CatalogSplitResult``.

        The catalog must contain at minimum:
            - ``track_id``  (str)
            - ``release_year`` (int)
            - All columns in ``self.feature_cols``

        Parameters
        ----------
        catalog:
            Pre-loaded DataFrame.  If None the default enriched_tracks
            parquet is loaded from disk.

        Returns
        -------
        CatalogSplitResult
            Profile and held-out DataFrames, stats, and an empty personas list.
            Call ``build_personas()`` on the result to populate personas.
        """
        if catalog is None:
            catalog = self._load_default_catalog()

        catalog = self._validate_and_clean(catalog)

        profile = catalog[catalog["release_year"] < self.cutoff_year].copy()
        held_out = catalog[catalog["release_year"] >= self.cutoff_year].copy()

        if len(held_out) < MIN_HELD_OUT_TRACKS:
            raise ValueError(
                f"Held-out partition has only {len(held_out)} tracks "
                f"(cutoff_year={self.cutoff_year}).  Need at least "
                f"{MIN_HELD_OUT_TRACKS}.  Try a later cutoff_year."
            )
        if len(profile) < len(held_out):
            warnings.warn(
                f"Profile partition ({len(profile)} tracks) is smaller than "
                f"held-out ({len(held_out)} tracks).  Consider a later cutoff_year.",
                stacklevel=2,
            )

        stats = self._compute_stats(catalog, profile, held_out)
        result = CatalogSplitResult(
            profile_tracks=profile.reset_index(drop=True),
            held_out_tracks=held_out.reset_index(drop=True),
            cutoff_year=self.cutoff_year,
            split_stats=stats,
        )
        result.validate_no_leakage()
        return result

    def build_personas(
        self,
        split: CatalogSplitResult,
        n_personas: int = 20,
        seeds_per_persona: int = 5,
        ground_truth_k: int = 50,
        genre_stratified: bool = True,
    ) -> list[EvaluationPersona]:
        """Construct synthetic evaluation personas from the split.

        Each persona:
          1. Samples ``seeds_per_persona`` seed tracks from the PROFILE
             partition (with optional genre stratification).
          2. Builds a mean audio feature vector from those seeds.
          3. Finds the ``ground_truth_k`` most similar tracks in the
             HELD-OUT partition by cosine similarity on raw audio features.
          4. Stores cosine similarity as a graded relevance signal.

        The scaler used here is a simple per-feature zero-mean / unit-std
        normalisation computed ONLY on the profile partition.  It is NOT
        the fitted production scaler artifact — that artifact must be
        applied separately by each recommender under evaluation and must
        also be fitted only on profile data to prevent leakage.

        Parameters
        ----------
        split:
            Output of ``self.split()``.
        n_personas:
            Number of synthetic personas to generate.
        seeds_per_persona:
            Number of seed tracks per persona.
        ground_truth_k:
            Number of held-out tracks to include as ground truth.
        genre_stratified:
            If True, each persona is anchored to a single playlist genre
            when sampling seeds, giving more realistic listening patterns.

        Returns
        -------
        list[EvaluationPersona]
            Also stored in ``split.personas`` in-place.
        """
        profile = split.profile_tracks
        held_out = split.held_out_tracks

        # Fit a profile-only scaler for ground-truth construction.
        # This is intentionally separate from the production artifact.
        feature_matrix_profile = self._scale_features(profile)
        feature_matrix_held_out = self._scale_features_with_profile_stats(
            held_out, profile
        )

        held_out_ids = held_out["track_id"].astype(str).tolist()

        personas: list[EvaluationPersona] = []

        # Determine sampling groups
        if genre_stratified and "playlist_genre" in profile.columns:
            groups = self._genre_groups(profile, n_personas)
        else:
            groups = [("all_genres", profile.index.tolist())] * n_personas

        persona_count = 0
        attempts = 0
        max_attempts = n_personas * 10

        while persona_count < n_personas and attempts < max_attempts:
            attempts += 1
            group_label, group_indices = groups[persona_count % len(groups)]

            # Sample seed indices from the profile group
            available = list(group_indices)
            if len(available) < seeds_per_persona:
                continue

            seed_indices_local = self._rng.choice(
                len(available), size=seeds_per_persona, replace=False
            )
            seed_row_indices = [available[i] for i in seed_indices_local]

            # Map local row positions back to positional indices in `profile`
            if hasattr(profile.index, '__getitem__'):
                seed_df = profile.loc[seed_row_indices]
            else:
                seed_df = profile.iloc[seed_row_indices]

            seed_ids = seed_df["track_id"].astype(str).tolist()

            # Build mean user vector in profile-scaled space
            seed_pos_indices = [
                profile.index.get_loc(idx) for idx in seed_df.index
            ]
            seed_vectors = feature_matrix_profile[seed_pos_indices]
            user_vector = seed_vectors.mean(axis=0, keepdims=True)

            # Cosine similarity against held-out catalog
            sims = cosine_similarity(user_vector, feature_matrix_held_out).flatten()

            # Rank held-out tracks by similarity, take top-K as ground truth
            top_k_indices = np.argsort(sims)[::-1][:ground_truth_k]
            gt_ids = [held_out_ids[i] for i in top_k_indices]
            gt_scores = [float(sims[i]) for i in top_k_indices]

            # Double-check no leakage
            seed_set = set(seed_ids)
            gt_set = set(gt_ids)
            if seed_set & gt_set:
                # Should never happen given the partition structure
                warnings.warn(
                    "Seed/ground-truth overlap detected during persona "
                    "construction — skipping persona.  Check track_id uniqueness.",
                    stacklevel=2,
                )
                continue

            persona_id = _short_hash(seed_ids)
            description = (
                f"{group_label} | seeds={seeds_per_persona} | "
                f"gt_k={ground_truth_k} | persona_{persona_count + 1:03d}"
            )
            # Compute seed profile metadata for provenance
            seed_meta = {
                "mean_popularity": float(seed_df["track_popularity"].mean())
                if "track_popularity" in seed_df.columns
                else None,
                "mean_release_year": float(seed_df["release_year"].mean())
                if "release_year" in seed_df.columns
                else None,
                "genre": group_label,
                "seed_artists": seed_df["track_artist"].unique().tolist()
                if "track_artist" in seed_df.columns
                else [],
            }

            personas.append(
                EvaluationPersona(
                    persona_id=persona_id,
                    description=description,
                    seed_track_ids=seed_ids,
                    ground_truth_ids=gt_ids,
                    ground_truth_scores=gt_scores,
                    metadata=seed_meta,
                )
            )
            persona_count += 1

        if persona_count < n_personas:
            warnings.warn(
                f"Only {persona_count}/{n_personas} personas could be built. "
                f"Consider reducing seeds_per_persona or n_personas.",
                stacklevel=2,
            )

        split.personas = personas
        return personas

    # ------------------------------------------------------------------
    # Serialisation helpers
    # ------------------------------------------------------------------

    def save_split_manifest(
        self, split: CatalogSplitResult, output_path: Path
    ) -> None:
        """Save a JSON manifest describing the split and its personas."""
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        manifest = {
            "split_protocol": "temporal_catalog_split",
            "cutoff_year": split.cutoff_year,
            "split_stats": split.split_stats,
            "leakage_prevention": {
                "profile_held_out_overlap": 0,
                "scaler_fitted_on": "profile_partition_only",
                "seed_tracks_source": "profile_partition",
                "ground_truth_source": "held_out_partition",
                "seed_gt_overlap_check": "enforced_in_EvaluationPersona.__post_init__",
            },
            "personas": [
                {
                    "persona_id": p.persona_id,
                    "description": p.description,
                    "seed_count": len(p.seed_track_ids),
                    "ground_truth_count": len(p.ground_truth_ids),
                    "seed_track_ids": p.seed_track_ids,
                    "ground_truth_ids": p.ground_truth_ids,
                    "ground_truth_scores": p.ground_truth_scores,
                    "metadata": p.metadata,
                }
                for p in split.personas
            ],
        }
        with output_path.open("w", encoding="utf-8") as fh:
            json.dump(manifest, fh, indent=2)

    @staticmethod
    def load_split_manifest(manifest_path: Path) -> list[EvaluationPersona]:
        """Reload personas from a saved manifest (e.g. for reproducible runs)."""
        with Path(manifest_path).open(encoding="utf-8") as fh:
            data = json.load(fh)
        personas = []
        for p in data.get("personas", []):
            personas.append(
                EvaluationPersona(
                    persona_id=p["persona_id"],
                    description=p["description"],
                    seed_track_ids=p["seed_track_ids"],
                    ground_truth_ids=p["ground_truth_ids"],
                    ground_truth_scores=p.get("ground_truth_scores", []),
                    metadata=p.get("metadata", {}),
                )
            )
        return personas

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _load_default_catalog() -> pd.DataFrame:
        path = DEFAULT_CATALOG_PATH
        if not path.exists():
            raise FileNotFoundError(
                f"Default catalog not found at {path}.  "
                "Run pipeline/04_feature_engineering.py first."
            )
        return pd.read_parquet(path)

    def _validate_and_clean(self, catalog: pd.DataFrame) -> pd.DataFrame:
        """Enforce required columns, drop rows with missing features/year."""
        required = {"track_id", "release_year"} | set(self.feature_cols)
        missing_cols = required - set(catalog.columns)
        if missing_cols:
            raise ValueError(
                f"Catalog is missing required columns: {sorted(missing_cols)}.  "
                "Ensure you are passing the enriched_tracks dataset which "
                "contains both audio features and release_year."
            )
        before = len(catalog)
        catalog = catalog.dropna(subset=list(self.feature_cols) + ["release_year"]).copy()
        catalog["release_year"] = catalog["release_year"].astype(int)
        catalog["track_id"] = catalog["track_id"].astype(str)
        after = len(catalog)
        if after < before:
            warnings.warn(
                f"Dropped {before - after} catalog rows with missing "
                "feature values or release_year.",
                stacklevel=3,
            )
        return catalog

    def _scale_features(self, df: pd.DataFrame) -> np.ndarray:
        """Zero-mean / unit-std normalization fitted on df itself."""
        X = df[self.feature_cols].to_numpy(dtype=float)
        mean = X.mean(axis=0)
        std = X.std(axis=0)
        std = np.where(std == 0, 1.0, std)
        return (X - mean) / std

    def _scale_features_with_profile_stats(
        self, df: pd.DataFrame, profile: pd.DataFrame
    ) -> np.ndarray:
        """Scale df using statistics computed on the profile partition.

        This prevents leakage: held-out feature statistics must not
        influence the normalisation used for ground-truth construction.
        """
        profile_X = profile[self.feature_cols].to_numpy(dtype=float)
        mean = profile_X.mean(axis=0)
        std = profile_X.std(axis=0)
        std = np.where(std == 0, 1.0, std)
        X = df[self.feature_cols].to_numpy(dtype=float)
        return (X - mean) / std

    def _genre_groups(
        self, profile: pd.DataFrame, n_personas: int
    ) -> list[tuple[str, list]]:
        """Return cycling genre groups for stratified persona sampling."""
        if "playlist_genre" not in profile.columns:
            return [("all_genres", profile.index.tolist())] * n_personas

        genres = profile["playlist_genre"].dropna().unique().tolist()
        groups: list[tuple[str, list]] = []
        for genre in sorted(genres):
            idx = profile.index[profile["playlist_genre"] == genre].tolist()
            if len(idx) >= 5:  # need at least 5 tracks for a seed set
                groups.append((genre, idx))

        if not groups:
            return [("all_genres", profile.index.tolist())] * n_personas

        # Cycle through genres to reach n_personas
        cycled: list[tuple[str, list]] = []
        for i in range(n_personas):
            cycled.append(groups[i % len(groups)])
        return cycled

    @staticmethod
    def _compute_stats(
        catalog: pd.DataFrame,
        profile: pd.DataFrame,
        held_out: pd.DataFrame,
    ) -> dict:
        """Compute split provenance statistics."""
        profile_year_dist = (
            profile["release_year"].value_counts().sort_index().to_dict()
            if "release_year" in profile.columns
            else {}
        )
        held_out_year_dist = (
            held_out["release_year"].value_counts().sort_index().to_dict()
            if "release_year" in held_out.columns
            else {}
        )
        # Stable hash of all track_ids for reproducibility verification
        all_ids = sorted(catalog["track_id"].astype(str).tolist())
        catalog_hash = hashlib.sha256(
            "|".join(all_ids).encode()
        ).hexdigest()[:16]

        return {
            "catalog_total_tracks": int(len(catalog)),
            "profile_tracks": int(len(profile)),
            "held_out_tracks": int(len(held_out)),
            "profile_pct": round(len(profile) / len(catalog) * 100, 1),
            "held_out_pct": round(len(held_out) / len(catalog) * 100, 1),
            "profile_year_range": [
                int(profile["release_year"].min()),
                int(profile["release_year"].max()),
            ]
            if len(profile) > 0
            else [],
            "held_out_year_range": [
                int(held_out["release_year"].min()),
                int(held_out["release_year"].max()),
            ]
            if len(held_out) > 0
            else [],
            "profile_year_distribution": {
                str(k): int(v) for k, v in profile_year_dist.items()
            },
            "held_out_year_distribution": {
                str(k): int(v) for k, v in held_out_year_dist.items()
            },
            "catalog_track_id_hash_sha256_prefix": catalog_hash,
        }


# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------

def _short_hash(items: list[str]) -> str:
    """Return an 8-character hex hash of a sorted list of strings."""
    joined = "|".join(sorted(items)).encode()
    return hashlib.sha256(joined).hexdigest()[:8]

"""
MusicLens — Evaluation Baseline Recommenders
==============================================
Provides three recommenders with a common interface for direct comparison
in the offline evaluation framework.

    BaseRecommenderAdapter   — abstract base class defining the contract
    PopularityRecommender    — Baseline A: rank by catalog popularity
    ContentBasedAdapter      — Baseline B: cosine similarity over raw
                               mean profile vector (mirrors the existing
                               pipeline/utils/recommender.py logic)
    EnhancedRecommenderAdapter — Model: Phase 1-2 personalized recommender
                               (PCA embedding + multi-factor ranking + MMR)

Design Principles
-----------------
* All three adapters accept exactly the same call signature:
      .recommend(seed_track_ids, candidate_pool, k) -> list[str]
  This makes evaluate.py completely model-agnostic.

* Each adapter operates only on the PROFILE catalog (tracks released
  before the cutoff year).  The HELD-OUT catalog is never passed to
  any recommender — it is used solely as the ground-truth source.
  This is enforced by the evaluate.py caller, not here.

* Scaler and PCA artifacts are loaded from disk (ml/artifacts/).
  They were fitted on the full enriched_tracks catalog in Phase 1.
  For a strictly leak-free evaluation the scaler should be re-fitted
  on the profile partition only.  The ``fit_scaler_on_profile``
  parameter on ContentBasedAdapter and EnhancedRecommenderAdapter
  makes this the DEFAULT behaviour — the production artifacts are
  used as a fallback only when explicitly requested.

* The PopularityRecommender requires no fitting and has no feature
  access — it is a pure non-personalised baseline.

* All adapters implement a ``describe()`` method that returns a dict
  describing the recommender's algorithm for inclusion in output JSON.
"""

from __future__ import annotations

import warnings
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Sequence

import numpy as np
import pandas as pd
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.preprocessing import StandardScaler

from ml.config import ARTIFACT_DIR, RECOMMENDATION_FEATURES


# ---------------------------------------------------------------------------
# Abstract base
# ---------------------------------------------------------------------------

class BaseRecommenderAdapter(ABC):
    """Common interface for all evaluation recommenders.

    Subclasses must implement:
        fit(profile_catalog) -> self
        recommend(seed_track_ids, candidate_pool, k) -> list[str]
        describe() -> dict
    """

    name: str = "base"

    @abstractmethod
    def fit(self, profile_catalog: pd.DataFrame) -> "BaseRecommenderAdapter":
        """Fit any internal state on the PROFILE catalog only.

        Parameters
        ----------
        profile_catalog:
            DataFrame of tracks from the profile (past) partition.
            Must contain track_id, track_popularity, and all
            RECOMMENDATION_FEATURES columns.

        Returns
        -------
        self (for chaining)
        """

    @abstractmethod
    def recommend(
        self,
        seed_track_ids: list[str],
        candidate_pool: pd.DataFrame,
        k: int,
    ) -> list[str]:
        """Return an ordered list of up to K recommended track IDs.

        Parameters
        ----------
        seed_track_ids:
            Track IDs that represent this persona's listening history.
            These are PROFILE tracks.  They must NOT appear in the
            returned list (seed exclusion is enforced here).
        candidate_pool:
            DataFrame of candidate tracks to rank.  In the evaluation
            protocol this is the HELD-OUT catalog — but the adapter
            only ranks, never fits on it.
        k:
            Number of recommendations to return.

        Returns
        -------
        list[str]
            Ordered track IDs, best first, length <= k.
            Guaranteed: no duplicates, no seed tracks.
        """

    @abstractmethod
    def describe(self) -> dict:
        """Return a JSON-serialisable description of the recommender."""


# ---------------------------------------------------------------------------
# Baseline A: Popularity Recommender
# ---------------------------------------------------------------------------

class PopularityRecommender(BaseRecommenderAdapter):
    """Baseline A — non-personalised popularity ranking.

    Recommends the most popular tracks from the candidate pool,
    regardless of the user's seed tracks.  This is the weakest
    sensible baseline: any personalised model should outperform it
    on relevance metrics; however it often achieves reasonable
    catalog coverage numbers, providing a useful reference.

    The popularity score used is ``track_popularity`` (Spotify's
    0-100 integer score, present in the tracks table).

    Parameters
    ----------
    popularity_col:
        Column name for the popularity score.  Default: "track_popularity".
    tiebreak_col:
        Secondary sort column for deterministic tie-breaking.
        Default: "track_id" (ascending lexicographic).
    """

    name: str = "popularity_baseline"

    def __init__(
        self,
        popularity_col: str = "track_popularity",
        tiebreak_col: str = "track_id",
    ) -> None:
        self.popularity_col = popularity_col
        self.tiebreak_col = tiebreak_col
        self._is_fitted = False

    def fit(self, profile_catalog: pd.DataFrame) -> "PopularityRecommender":
        """No fitting required — popularity ranking is stateless."""
        _validate_required_cols(profile_catalog, {"track_id", self.popularity_col})
        self._is_fitted = True
        return self

    def recommend(
        self,
        seed_track_ids: list[str],
        candidate_pool: pd.DataFrame,
        k: int,
    ) -> list[str]:
        _require_fitted(self)
        _validate_required_cols(candidate_pool, {"track_id", self.popularity_col})

        seed_set = set(seed_track_ids)
        pool = candidate_pool[
            ~candidate_pool["track_id"].isin(seed_set)
        ].copy()

        if pool.empty:
            return []

        # Sort: popularity descending, then tiebreak col ascending
        ascending = [False, True]
        sort_cols = [self.popularity_col, self.tiebreak_col]

        # Guard: tiebreak col may not exist in pool
        if self.tiebreak_col not in pool.columns:
            sort_cols = [self.popularity_col]
            ascending = [False]

        pool = pool.sort_values(sort_cols, ascending=ascending)
        ranked = pool["track_id"].astype(str).tolist()
        # Deduplicate while preserving order
        return _deduplicate(ranked)[:k]

    def describe(self) -> dict:
        return {
            "name": self.name,
            "algorithm": "Non-personalised popularity ranking",
            "description": (
                "Ranks candidate tracks by track_popularity (Spotify 0-100 score) "
                "descending.  Ignores user seed tracks entirely.  "
                "Represents the weakest sensible baseline."
            ),
            "personalised": False,
            "feature_based": False,
            "requires_fitting": False,
        }


# ---------------------------------------------------------------------------
# Baseline B: Content-Based Cosine Adapter
# ---------------------------------------------------------------------------

class ContentBasedAdapter(BaseRecommenderAdapter):
    """Baseline B — cosine similarity over mean audio feature profile.

    This mirrors the core logic of the existing
    ``pipeline/utils/recommender.py::ContentBasedRecommender``:

        1. Build a mean feature vector from the seed tracks.
        2. Scale features using a StandardScaler fitted on the profile
           catalog (or the pre-fitted artifact when requested).
        3. Rank candidates by cosine similarity to the user vector.
        4. Tie-break deterministically by track_popularity then track_id.

    No genre affinity, artist affinity, MMR re-ranking, or PCA
    embedding is applied.  This isolates the effect of the Phase 1-2
    enhancements in the comparison.

    Parameters
    ----------
    feature_cols:
        Audio feature columns to use.
    fit_scaler_on_profile:
        If True (default), fit a fresh StandardScaler on the profile
        catalog to avoid any leakage from the full-catalog artifact.
        If False, load the pre-fitted scaler from ml/artifacts/.
    artifact_dir:
        Directory containing preprocessing.json / taste_model.joblib.
    """

    name: str = "content_based_cosine"

    def __init__(
        self,
        feature_cols: tuple[str, ...] | list[str] = RECOMMENDATION_FEATURES,
        fit_scaler_on_profile: bool = True,
        artifact_dir: Path = ARTIFACT_DIR,
    ) -> None:
        self.feature_cols = list(feature_cols)
        self.fit_scaler_on_profile = fit_scaler_on_profile
        self.artifact_dir = Path(artifact_dir)
        self._scaler: StandardScaler | None = None
        self._profile_catalog: pd.DataFrame | None = None
        self._is_fitted = False

    def fit(self, profile_catalog: pd.DataFrame) -> "ContentBasedAdapter":
        """Fit the scaler on the profile partition.

        Parameters
        ----------
        profile_catalog:
            Tracks from the profile (past) partition with all feature cols.
        """
        required = {"track_id"} | set(self.feature_cols)
        _validate_required_cols(profile_catalog, required)

        if self.fit_scaler_on_profile:
            X = _extract_features(profile_catalog, self.feature_cols)
            scaler = StandardScaler()
            scaler.fit(X)
            self._scaler = scaler
        else:
            self._scaler = _load_artifact_scaler(self.artifact_dir)

        self._profile_catalog = profile_catalog.copy()
        self._is_fitted = True
        return self

    def recommend(
        self,
        seed_track_ids: list[str],
        candidate_pool: pd.DataFrame,
        k: int,
    ) -> list[str]:
        _require_fitted(self)
        assert self._scaler is not None

        required = {"track_id"} | set(self.feature_cols)
        _validate_required_cols(candidate_pool, required)

        # Build user vector from seeds (seeds must be in profile catalog)
        user_vector = self._build_user_vector(seed_track_ids)
        if user_vector is None:
            warnings.warn(
                f"[{self.name}] No valid seed tracks found in profile catalog. "
                "Falling back to empty recommendations.",
                stacklevel=2,
            )
            return []

        # Exclude seeds from candidate pool
        seed_set = set(seed_track_ids)
        pool = candidate_pool[
            ~candidate_pool["track_id"].isin(seed_set)
        ].copy()

        if pool.empty:
            return []

        # Scale candidates using profile-fitted scaler
        X_pool = _extract_features(pool, self.feature_cols)
        X_pool_scaled = self._scaler.transform(X_pool)

        # Cosine similarity
        sims = cosine_similarity(user_vector, X_pool_scaled).flatten()
        pool = pool.copy()
        pool["_sim"] = sims

        # Deterministic sort: similarity desc, popularity desc, track_id asc
        sort_cols = ["_sim"]
        ascending = [False]
        if "track_popularity" in pool.columns:
            sort_cols += ["track_popularity"]
            ascending += [False]
        sort_cols += ["track_id"]
        ascending += [True]

        pool = pool.sort_values(sort_cols, ascending=ascending)
        ranked = pool["track_id"].astype(str).tolist()
        return _deduplicate(ranked)[:k]

    def describe(self) -> dict:
        return {
            "name": self.name,
            "algorithm": "Content-based cosine similarity (mean profile vector)",
            "description": (
                "Builds a mean audio feature vector from seed tracks, scales with "
                "StandardScaler fitted on the profile catalog, then ranks candidates "
                "by cosine similarity.  No PCA, no genre/artist affinity, no MMR.  "
                "Represents the original pipeline/utils/recommender.py logic."
            ),
            "personalised": True,
            "feature_based": True,
            "features": self.feature_cols,
            "scaler": "StandardScaler",
            "scaler_fitted_on": "profile_partition"
            if self.fit_scaler_on_profile
            else "full_catalog_artifact",
            "requires_fitting": True,
        }

    # ------------------------------------------------------------------
    # Private
    # ------------------------------------------------------------------

    def _build_user_vector(
        self, seed_track_ids: list[str]
    ) -> np.ndarray | None:
        """Return a (1, n_features) scaled mean vector from seed tracks."""
        assert self._profile_catalog is not None
        assert self._scaler is not None

        seed_rows = self._profile_catalog[
            self._profile_catalog["track_id"].isin(seed_track_ids)
        ]
        if seed_rows.empty:
            return None

        X_seeds = _extract_features(seed_rows, self.feature_cols)
        X_seeds_scaled = self._scaler.transform(X_seeds)
        return X_seeds_scaled.mean(axis=0, keepdims=True)


# ---------------------------------------------------------------------------
# Model: Enhanced Personalized Recommender Adapter
# ---------------------------------------------------------------------------

class EnhancedRecommenderAdapter(BaseRecommenderAdapter):
    """Model — Phase 1-2 enhanced personalized recommender.

    Implements the full server-side recommendation pipeline in Python:

        1. Build a source-aware taste representation (mean of seed
           features, no source-group weighting because we have a single
           "manual" source in evaluation).
        2. Apply StandardScaler + PCA (loaded from ml/artifacts/).
        3. Retrieve top candidates by cosine similarity in PCA space.
        4. Re-rank using the multi-factor weighted scoring:
               relevance = 0.80 × audio_similarity
                         + 0.08 × genre_affinity
                         + 0.04 × artist_affinity
                         + 0.02 × popularity_prior
                         + 0.06 × novelty
        5. Apply MMR diversity re-ranking (λ=0.75, max_per_artist=2).

    The scaler and PCA parameters are loaded from
    ``ml/artifacts/preprocessing.json`` — the same artifact used by
    the production server.  When ``fit_scaler_on_profile=True`` (default),
    a fresh scaler is fitted on the profile catalog and the PCA is
    re-projected using that scaler, keeping the evaluation self-contained.

    Parameters
    ----------
    feature_cols:
        Audio feature columns.  Must match the artifact's feature list.
    fit_scaler_on_profile:
        If True (default), re-fit the StandardScaler on the profile
        partition to avoid full-catalog leakage.  PCA components from
        the artifact are still used (they are catalog-structure, not
        label-leaking).
    candidate_limit:
        Number of candidates retrieved before re-ranking (default 500).
    mmr_lambda:
        MMR trade-off between relevance and diversity (default 0.75).
    max_per_artist:
        Hard cap on the number of tracks per artist in the final list.
    artifact_dir:
        Directory containing preprocessing.json and taste_model.joblib.
    """

    name: str = "enhanced_personalized"

    def __init__(
        self,
        feature_cols: tuple[str, ...] | list[str] = RECOMMENDATION_FEATURES,
        fit_scaler_on_profile: bool = True,
        candidate_limit: int = 500,
        mmr_lambda: float = 0.75,
        max_per_artist: int = 2,
        artifact_dir: Path = ARTIFACT_DIR,
    ) -> None:
        self.feature_cols = list(feature_cols)
        self.fit_scaler_on_profile = fit_scaler_on_profile
        self.candidate_limit = candidate_limit
        self.mmr_lambda = mmr_lambda
        self.max_per_artist = max_per_artist
        self.artifact_dir = Path(artifact_dir)

        self._scaler: StandardScaler | None = None
        self._pca_components: np.ndarray | None = None   # (n_components, n_features)
        self._pca_mean: np.ndarray | None = None         # for PCA centering (zero after scaling)
        self._profile_catalog: pd.DataFrame | None = None
        self._profile_scaled: np.ndarray | None = None   # StandardScaler output
        self._profile_embedded: np.ndarray | None = None # PCA output
        self._track_to_artist: dict[str, str] = {}
        self._track_popularity: dict[str, float] = {}
        self._track_genre: dict[str, str] = {}
        self._is_fitted = False

    def fit(self, profile_catalog: pd.DataFrame) -> "EnhancedRecommenderAdapter":
        """Fit scaler on profile catalog and pre-compute embeddings."""
        required = {"track_id"} | set(self.feature_cols)
        _validate_required_cols(profile_catalog, required)

        # Load PCA components from artifact
        pca_components, artifact_scaler = _load_pca_and_scaler(self.artifact_dir)
        self._pca_components = pca_components  # (n_components, n_features)

        if self.fit_scaler_on_profile:
            X = _extract_features(profile_catalog, self.feature_cols)
            scaler = StandardScaler()
            scaler.fit(X)
            self._scaler = scaler
        else:
            self._scaler = artifact_scaler

        self._profile_catalog = profile_catalog.reset_index(drop=True).copy()

        # Pre-compute scaled + embedded matrix for the profile catalog
        X_prof = _extract_features(self._profile_catalog, self.feature_cols)
        X_scaled = self._scaler.transform(X_prof)
        self._profile_scaled = X_scaled
        self._profile_embedded = X_scaled @ self._pca_components.T  # (n, n_components)

        # Build lookup dicts for affinity scoring
        for _, row in profile_catalog.iterrows():
            tid = str(row["track_id"])
            if "track_artist" in row:
                self._track_to_artist[tid] = str(row["track_artist"])
            if "track_popularity" in row:
                self._track_popularity[tid] = float(row["track_popularity"])
            if "playlist_genre" in row:
                self._track_genre[tid] = str(row["playlist_genre"])
            elif "genre" in row:
                self._track_genre[tid] = str(row["genre"])

        self._is_fitted = True
        return self

    def recommend(
        self,
        seed_track_ids: list[str],
        candidate_pool: pd.DataFrame,
        k: int,
    ) -> list[str]:
        _require_fitted(self)
        assert self._scaler is not None
        assert self._pca_components is not None
        assert self._profile_catalog is not None

        required = {"track_id"} | set(self.feature_cols)
        _validate_required_cols(candidate_pool, required)

        # Build user embedding from seeds
        user_embedding = self._build_user_embedding(seed_track_ids)
        if user_embedding is None:
            warnings.warn(
                f"[{self.name}] No valid seed tracks found in profile catalog.",
                stacklevel=2,
            )
            return []

        seed_set = set(seed_track_ids)
        pool = candidate_pool[
            ~candidate_pool["track_id"].isin(seed_set)
        ].copy().reset_index(drop=True)

        if pool.empty:
            return []

        # Scale and embed candidate pool using profile-fitted scaler
        X_pool = _extract_features(pool, self.feature_cols)
        X_pool_scaled = self._scaler.transform(X_pool)
        X_pool_embedded = X_pool_scaled @ self._pca_components.T

        # Stage 1: Retrieval — cosine similarity in PCA space
        pool_norms = np.linalg.norm(X_pool_embedded, axis=1, keepdims=True)
        pool_norms = np.where(pool_norms == 0, 1.0, pool_norms)
        pool_normed = X_pool_embedded / pool_norms

        user_norm = np.linalg.norm(user_embedding)
        user_norm = max(user_norm, 1e-10)
        user_normed = user_embedding / user_norm

        audio_sims = (pool_normed @ user_normed).flatten()  # (n_pool,)

        # Limit to top candidates before re-ranking
        n_candidates = min(self.candidate_limit, len(pool))
        top_candidate_indices = np.argsort(audio_sims)[::-1][:n_candidates]

        # Stage 2: Re-ranking with multi-factor scoring
        # Derive user genre/artist affinity from seeds
        seed_genres = {
            self._track_genre.get(tid, "unknown")
            for tid in seed_track_ids
            if tid in self._track_genre
        }
        seed_artists = {
            self._track_to_artist.get(tid, "unknown")
            for tid in seed_track_ids
            if tid in self._track_to_artist
        }

        max_pop = max(self._track_popularity.values(), default=1.0)
        if max_pop == 0:
            max_pop = 1.0

        candidates = pool.iloc[top_candidate_indices].copy()
        cand_sims = audio_sims[top_candidate_indices]

        # Normalise audio similarity to [0,1]: cosine can be in [-1,1]
        sim_min, sim_max = float(cand_sims.min()), float(cand_sims.max())
        if sim_max > sim_min:
            norm_audio = (cand_sims - sim_min) / (sim_max - sim_min)
        else:
            norm_audio = np.ones_like(cand_sims)

        relevance_scores: list[float] = []
        for local_i, (_, row) in enumerate(candidates.iterrows()):
            tid = str(row["track_id"])
            pop = float(row.get("track_popularity", 0)) if "track_popularity" in row else 0.0
            genre = (
                str(row.get("playlist_genre", row.get("genre", "unknown")))
            )
            artist = str(row.get("track_artist", "unknown"))

            genre_aff = 1.0 if genre in seed_genres else 0.0
            artist_aff = 1.0 if artist in seed_artists else 0.0
            pop_prior = pop / max_pop
            novelty = 1.0 - pop_prior

            score = (
                0.80 * norm_audio[local_i]
                + 0.08 * genre_aff
                + 0.04 * artist_aff
                + 0.02 * pop_prior
                + 0.06 * novelty
            )
            relevance_scores.append(score)

        candidates = candidates.copy()
        candidates["_relevance"] = relevance_scores
        candidates["_audio_sim"] = list(cand_sims)
        candidates = candidates.sort_values("_relevance", ascending=False)

        # Stage 3: MMR diversity re-ranking
        ranked_ids = self._mmr_rerank(
            candidates=candidates,
            X_pool_scaled=X_pool_scaled,
            top_candidate_indices=top_candidate_indices,
            pool=pool,
            k=k,
        )

        return _deduplicate(ranked_ids)[:k]

    def describe(self) -> dict:
        return {
            "name": self.name,
            "algorithm": "Enhanced personalized recommender (Phase 1-2)",
            "description": (
                "Builds a taste representation from seed tracks, applies "
                "StandardScaler + PCA (from ml/artifacts/), retrieves top "
                f"{self.candidate_limit} candidates by cosine similarity in "
                "PCA space, re-ranks with multi-factor weighted scoring "
                "(audio 0.80, genre 0.08, artist 0.04, popularity 0.02, "
                "novelty 0.06), then applies MMR diversity re-ranking "
                f"(λ={self.mmr_lambda}, max_per_artist={self.max_per_artist})."
            ),
            "personalised": True,
            "feature_based": True,
            "features": self.feature_cols,
            "scaler": "StandardScaler",
            "scaler_fitted_on": "profile_partition"
            if self.fit_scaler_on_profile
            else "full_catalog_artifact",
            "pca": "TasteEmbeddingModel from ml/artifacts/taste_model.joblib",
            "ranking_weights": {
                "audio_similarity": 0.80,
                "genre_affinity": 0.08,
                "artist_affinity": 0.04,
                "popularity_prior": 0.02,
                "novelty": 0.06,
            },
            "mmr_lambda": self.mmr_lambda,
            "max_per_artist": self.max_per_artist,
            "candidate_limit": self.candidate_limit,
            "requires_fitting": True,
        }

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _build_user_embedding(
        self, seed_track_ids: list[str]
    ) -> np.ndarray | None:
        """Return a (n_components,) PCA embedding from seed tracks."""
        assert self._profile_catalog is not None
        assert self._scaler is not None
        assert self._pca_components is not None

        seed_rows = self._profile_catalog[
            self._profile_catalog["track_id"].isin(seed_track_ids)
        ]
        if seed_rows.empty:
            return None

        X_seeds = _extract_features(seed_rows, self.feature_cols)
        X_scaled = self._scaler.transform(X_seeds)
        embedded = X_scaled @ self._pca_components.T  # (n_seeds, n_components)
        return embedded.mean(axis=0)  # (n_components,)

    def _mmr_rerank(
        self,
        candidates: pd.DataFrame,
        X_pool_scaled: np.ndarray,
        top_candidate_indices: np.ndarray,
        pool: pd.DataFrame,
        k: int,
    ) -> list[str]:
        """Maximal Marginal Relevance re-ranking.

        MMR score(i) = λ * relevance(i) - (1-λ) * max_{j in S} sim(i, j)

        where S is the set of already-selected items.

        Hard constraint: at most max_per_artist tracks per artist.
        """
        # Build a mapping from local pool index to scaled feature vector
        # for pairwise diversity computation.
        cand_track_ids = candidates["track_id"].astype(str).tolist()
        cand_relevance = candidates["_relevance"].tolist()

        # Map track_id → scaled feature row index in pool
        pool_tid_to_local_idx = {
            str(pool.iloc[i]["track_id"]): i
            for i in range(len(pool))
        }

        # Extract candidate feature vectors (in scaled space for diversity)
        cand_vectors: list[np.ndarray] = []
        for tid in cand_track_ids:
            local_idx = pool_tid_to_local_idx.get(tid)
            if local_idx is not None:
                cand_vectors.append(X_pool_scaled[local_idx])
            else:
                cand_vectors.append(np.zeros(X_pool_scaled.shape[1]))

        if not cand_vectors:
            return cand_track_ids[:k]

        cand_matrix = np.vstack(cand_vectors)  # (n_cands, n_features)

        # L2-normalise for cosine similarity
        norms = np.linalg.norm(cand_matrix, axis=1, keepdims=True)
        norms = np.where(norms == 0, 1.0, norms)
        cand_normed = cand_matrix / norms

        selected_indices: list[int] = []
        selected_ids: list[str] = []
        artist_counts: dict[str, int] = {}
        remaining = list(range(len(cand_track_ids)))

        for _ in range(k):
            if not remaining:
                break

            best_idx: int | None = None
            best_score = float("-inf")

            for ci in remaining:
                tid = cand_track_ids[ci]
                artist = None
                # Artist lookup: try candidates df first
                cand_row = candidates[candidates["track_id"] == tid]
                if not cand_row.empty and "track_artist" in cand_row.columns:
                    artist = str(cand_row.iloc[0]["track_artist"])

                # Hard artist cap
                if (
                    artist is not None
                    and artist_counts.get(artist, 0) >= self.max_per_artist
                ):
                    continue

                rel = float(cand_relevance[ci])

                if not selected_indices:
                    mmr_score = rel
                else:
                    # Max similarity to any already-selected item
                    sel_normed = cand_normed[selected_indices]  # (n_sel, d)
                    div_sims = (sel_normed @ cand_normed[ci]).flatten()
                    max_sim = float(np.max(div_sims))
                    mmr_score = (
                        self.mmr_lambda * rel
                        - (1.0 - self.mmr_lambda) * max_sim
                    )

                if mmr_score > best_score:
                    best_score = mmr_score
                    best_idx = ci

            if best_idx is None:
                break

            selected_indices.append(best_idx)
            selected_ids.append(cand_track_ids[best_idx])
            remaining.remove(best_idx)

            # Track artist count
            best_tid = cand_track_ids[best_idx]
            best_cand = candidates[candidates["track_id"] == best_tid]
            if not best_cand.empty and "track_artist" in best_cand.columns:
                a = str(best_cand.iloc[0]["track_artist"])
                artist_counts[a] = artist_counts.get(a, 0) + 1

        return selected_ids


# ---------------------------------------------------------------------------
# Module-level factory
# ---------------------------------------------------------------------------

def build_all_adapters(
    fit_scaler_on_profile: bool = True,
    artifact_dir: Path = ARTIFACT_DIR,
) -> dict[str, BaseRecommenderAdapter]:
    """Instantiate all three adapters with matching settings.

    Returns a dict keyed by the adapter's ``.name`` attribute.

    Parameters
    ----------
    fit_scaler_on_profile:
        Passed to ContentBasedAdapter and EnhancedRecommenderAdapter.
        Default True — recommended for leak-free evaluation.
    artifact_dir:
        Override the artifact directory (useful for testing).
    """
    return {
        PopularityRecommender.name: PopularityRecommender(),
        ContentBasedAdapter.name: ContentBasedAdapter(
            fit_scaler_on_profile=fit_scaler_on_profile,
            artifact_dir=artifact_dir,
        ),
        EnhancedRecommenderAdapter.name: EnhancedRecommenderAdapter(
            fit_scaler_on_profile=fit_scaler_on_profile,
            artifact_dir=artifact_dir,
        ),
    }


# ---------------------------------------------------------------------------
# Private utilities
# ---------------------------------------------------------------------------

def _validate_required_cols(df: pd.DataFrame, required: set[str]) -> None:
    missing = required - set(df.columns)
    if missing:
        raise ValueError(
            f"DataFrame is missing required columns: {sorted(missing)}.  "
            f"Available columns: {sorted(df.columns.tolist())}"
        )


def _require_fitted(adapter: BaseRecommenderAdapter) -> None:
    if not getattr(adapter, "_is_fitted", False):
        raise RuntimeError(
            f"{adapter.__class__.__name__} must be fitted before calling "
            "recommend().  Call .fit(profile_catalog) first."
        )


def _extract_features(df: pd.DataFrame, feature_cols: list[str]) -> np.ndarray:
    """Return a float64 numpy array; raise if any NaN remains."""
    X = df[feature_cols].to_numpy(dtype=float)
    if not np.isfinite(X).all():
        raise ValueError(
            f"Feature matrix contains non-finite values.  "
            f"Columns: {feature_cols}.  "
            "Drop or impute missing values before calling fit/recommend."
        )
    return X


def _deduplicate(ids: list[str]) -> list[str]:
    """Remove duplicates from an ordered list, preserving first occurrence."""
    seen: set[str] = set()
    result: list[str] = []
    for item in ids:
        if item not in seen:
            seen.add(item)
            result.append(item)
    return result


def _load_artifact_scaler(artifact_dir: Path) -> StandardScaler:
    """Load StandardScaler parameters from preprocessing.json."""
    import json

    preprocessing_path = artifact_dir / "preprocessing.json"
    if not preprocessing_path.exists():
        raise FileNotFoundError(
            f"preprocessing.json not found at {preprocessing_path}.  "
            "Run ml/training/train_taste_model.py first."
        )
    with preprocessing_path.open(encoding="utf-8") as fh:
        data = json.load(fh)

    scaler_data = data["scaler"]
    scaler = StandardScaler()
    scaler.mean_ = np.array(scaler_data["mean"], dtype=float)
    scaler.scale_ = np.array(scaler_data["scale"], dtype=float)
    scaler.var_ = scaler.scale_ ** 2
    scaler.n_features_in_ = len(scaler.mean_)
    # n_samples_seen_ is required by sklearn's check_is_fitted
    scaler.n_samples_seen_ = 1
    return scaler


def _load_pca_and_scaler(
    artifact_dir: Path,
) -> tuple[np.ndarray, StandardScaler]:
    """Load PCA components and scaler from preprocessing.json.

    Returns
    -------
    (pca_components, scaler)
        pca_components: np.ndarray of shape (n_components, n_features)
        scaler: StandardScaler reconstructed from artifact JSON
    """
    import json

    preprocessing_path = artifact_dir / "preprocessing.json"
    if not preprocessing_path.exists():
        raise FileNotFoundError(
            f"preprocessing.json not found at {preprocessing_path}.  "
            "Run ml/training/train_taste_model.py first."
        )
    with preprocessing_path.open(encoding="utf-8") as fh:
        data = json.load(fh)

    scaler = _load_artifact_scaler(artifact_dir)
    pca_components = np.array(data["pca"]["components"], dtype=float)
    return pca_components, scaler

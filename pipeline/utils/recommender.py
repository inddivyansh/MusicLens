"""
MusicLens — Explainable Content-Based Recommendation Engine
============================================================
A transparent, statistically grounded recommendation system based on
cosine similarity over normalized Spotify audio features.

Key Design Decisions:
  1. Content-Based over Black-Box Neural: High explainability, 0 cold-start
     issue for new users, deterministic behavior, and direct feature attribution.
  2. Cosine Similarity: Measures directional orientation of audio feature vectors
     independent of absolute magnitude, well-suited for normalized audio spaces.
  3. Strict Safeguards: Seed track exclusion, zero duplicate recommendations,
     bounds verification, and deterministic tie-breaking.
"""

from typing import List, Dict, Any, Optional, Union, Tuple
import numpy as np
import pandas as pd
from sklearn.metrics.pairwise import cosine_similarity

from pipeline.config import RECOMMENDATION_FEATURES
from pipeline.utils.feature_engineering import AudioFeatureScaler
from pipeline.utils.user_profile import UserMusicProfile


class ContentBasedRecommender:
    """
    Production-grade content-based recommendation engine for MusicLens.
    """

    def __init__(
        self,
        tracks_df: pd.DataFrame,
        audio_features_df: pd.DataFrame,
        playlist_tracks_df: Optional[pd.DataFrame] = None,
        feature_cols: Optional[List[str]] = None,
        scaler: Optional[AudioFeatureScaler] = None,
    ):
        """
        Initialize the recommender with track catalog and audio features.

        Args:
            tracks_df: Cleaned tracks DataFrame (track_id, track_name, track_artist, track_popularity, etc.)
            audio_features_df: Cleaned audio features DataFrame (track_id, danceability, energy, ...)
            playlist_tracks_df: Optional playlist bridge for genre/subgenre metadata.
            feature_cols: List of continuous features for similarity calculation.
            scaler: Optional pre-fitted AudioFeatureScaler. If None, a new MinMaxScaler is fitted.
        """
        self.feature_cols = feature_cols or list(RECOMMENDATION_FEATURES)

        # 1. Merge tracks and audio features on track_id (inner join ensures 100% complete records)
        merged = tracks_df.merge(
            audio_features_df[["track_id"] + [c for c in self.feature_cols if c in audio_features_df.columns]],
            on="track_id",
            how="inner"
        ).drop_duplicates(subset=["track_id"]).reset_index(drop=True)

        if merged.empty:
            raise ValueError("Merged catalog is empty. Check tracks_df and audio_features_df compatibility.")

        # Ensure no nulls in feature columns
        initial_len = len(merged)
        merged = merged.dropna(subset=self.feature_cols).reset_index(drop=True)
        if len(merged) < initial_len:
            print(f"[Recommender] Dropped {initial_len - len(merged)} tracks with missing audio features.")

        self.catalog = merged
        self.playlist_tracks_df = playlist_tracks_df

        # Pre-compute primary genre mapping if playlist data is provided
        self.track_genres: Dict[str, str] = {}
        self.track_subgenres: Dict[str, str] = {}
        if playlist_tracks_df is not None and not playlist_tracks_df.empty:
            # Map each track to its most frequent genre/subgenre
            if "playlist_genre" in playlist_tracks_df.columns:
                g_map = (
                    playlist_tracks_df.groupby("track_id")["playlist_genre"]
                    .agg(lambda s: s.mode().iloc[0] if not s.empty else "Unknown")
                    .to_dict()
                )
                self.track_genres = g_map
            if "playlist_subgenre" in playlist_tracks_df.columns:
                sg_map = (
                    playlist_tracks_df.groupby("track_id")["playlist_subgenre"]
                    .agg(lambda s: s.mode().iloc[0] if not s.empty else "Unknown")
                    .to_dict()
                )
                self.track_subgenres = sg_map

        # Add genre column to catalog
        self.catalog["genre"] = self.catalog["track_id"].map(lambda t: self.track_genres.get(t, "Other"))
        self.catalog["subgenre"] = self.catalog["track_id"].map(lambda t: self.track_subgenres.get(t, "Other"))

        # 2. Fit and compute scaled feature matrix
        self.scaler = scaler or AudioFeatureScaler(feature_cols=self.feature_cols, scaler_type="standard")
        if not self.scaler.is_fitted:
            self.scaler.fit(self.catalog)

        self.feature_matrix = self.scaler.transform(self.catalog)
        self.track_id_to_idx = {t_id: idx for idx, t_id in enumerate(self.catalog["track_id"])}

        # Precompute min-max spans for explainability percentages
        self.feature_spans = {}
        for feat in self.feature_cols:
            min_v = float(self.catalog[feat].min())
            max_v = float(self.catalog[feat].max())
            self.feature_spans[feat] = max(max_v - min_v, 1e-6)

    def build_user_vector(
        self,
        seed_track_ids: List[str],
        weights: Optional[List[float]] = None,
    ) -> Tuple[np.ndarray, List[str]]:
        """
        Build an aggregated user preference vector from selected seed track IDs.

        Args:
            seed_track_ids: List of track IDs chosen by the user.
            weights: Optional importance weights for each seed track.

        Returns:
            Tuple of (user_vector_1d_array, list_of_valid_track_ids).
        """
        valid_indices = []
        valid_ids = []
        valid_weights = []

        for idx, t_id in enumerate(seed_track_ids):
            if t_id in self.track_id_to_idx:
                row_idx = self.track_id_to_idx[t_id]
                valid_indices.append(row_idx)
                valid_ids.append(t_id)
                w = weights[idx] if weights and idx < len(weights) else 1.0
                valid_weights.append(w)

        if not valid_indices:
            raise ValueError(
                f"None of the provided seed tracks exist in the catalog. Provided: {seed_track_ids[:5]}..."
            )

        vectors = self.feature_matrix[valid_indices]
        w_arr = np.array(valid_weights, dtype=float).reshape(-1, 1)
        w_arr = w_arr / np.sum(w_arr)  # normalize weights

        user_vector = np.sum(vectors * w_arr, axis=0, keepdims=True)
        return user_vector, valid_ids

    def _explain_recommendation(
        self,
        user_vector_scaled: np.ndarray,
        song_vector_scaled: np.ndarray,
        song_raw_row: pd.Series,
        user_raw_means: Dict[str, float],
        user_dominant_genre: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Generate feature-level attribution and explainability for a single recommendation.

        Calculates proximity per feature, top contributing dimensions, and natural
        language explanation.
        """
        u_scaled = user_vector_scaled.flatten()
        s_scaled = song_vector_scaled.flatten()

        feature_proximities = {}
        feature_deltas = {}
        for idx, feat in enumerate(self.feature_cols):
            raw_song_val = float(song_raw_row.get(feat, 0.0))
            raw_user_val = float(user_raw_means.get(feat, 0.0))
            raw_diff = abs(raw_song_val - raw_user_val)

            # Proximity percentage relative to full feature domain span
            span = self.feature_spans.get(feat, 1.0)
            prox_pct = max(0.0, (1.0 - (raw_diff / span))) * 100.0
            feature_proximities[feat] = round(prox_pct, 1)

            # Raw delta: song_val - user_mean_val
            feature_deltas[feat] = round(raw_song_val - raw_user_val, 4)

        # Top 3 matching features
        sorted_matches = sorted(feature_proximities.items(), key=lambda x: x[1], reverse=True)
        top_matches = sorted_matches[:3]

        song_genre = song_raw_row.get("genre", "Other")
        shares_genre = user_dominant_genre is not None and song_genre.lower() == user_dominant_genre.lower()

        # Build natural language narrative
        top_1_name, top_1_score = top_matches[0]
        top_2_name, top_2_score = top_matches[1]

        narrative_parts = [
            f"Strong alignment in {top_1_name.capitalize()} ({top_1_score:.0f}% match) "
            f"and {top_2_name.capitalize()} ({top_2_score:.0f}% match)"
        ]
        if shares_genre and song_genre != "Other":
            narrative_parts.append(f"shares your preferred genre ({song_genre})")

        explanation_summary = ", ".join(narrative_parts) + "."

        return {
            "top_matching_features": [
                {"feature": feat, "similarity_pct": score, "song_value": round(float(song_raw_row.get(feat, 0.0)), 3)}
                for feat, score in top_matches
            ],
            "feature_proximities_pct": feature_proximities,
            "feature_deltas": feature_deltas,
            "shares_dominant_genre": shares_genre,
            "explanation_text": explanation_summary,
        }

    def recommend(
        self,
        seed_track_ids: List[str],
        top_n: int = 10,
        genre_filter: Optional[Union[str, List[str]]] = None,
        min_popularity: Optional[int] = None,
        exclude_selected: bool = True,
        weights: Optional[List[float]] = None,
    ) -> Dict[str, Any]:
        """
        Generate top-N explainable recommendations based on seed track IDs.

        Args:
            seed_track_ids: List of seed track IDs.
            top_n: Number of recommendations to return (default: 10).
            genre_filter: Optional genre name or list of genres to restrict candidates.
            min_popularity: Optional minimum popularity score (0-100).
            exclude_selected: If True, exclude seed tracks from results (default: True).
            weights: Optional weights corresponding to seed tracks.

        Returns:
            Dict containing user profile, list of recommendations with similarity scores & explanations.
        """
        if top_n <= 0:
            raise ValueError("top_n must be a positive integer.")

        # 1. Build user vector and identify valid seed IDs
        user_vector_scaled, valid_seed_ids = self.build_user_vector(seed_track_ids, weights)

        # 2. Build User Music Profile for analytics & explainability
        user_profile = UserMusicProfile(
            seed_track_ids=valid_seed_ids,
            seed_tracks_df=self.catalog,
            audio_features_df=self.catalog,
            playlist_tracks_df=self.playlist_tracks_df,
        )
        profile_dict = user_profile.to_dict()
        user_raw_means = profile_dict["raw_feature_means"]
        user_dominant_genres = list(profile_dict["dominant_genres_pct"].keys())
        top_user_genre = user_dominant_genres[0] if user_dominant_genres else None

        # 3. Calculate cosine similarity across the entire catalog matrix
        similarities = cosine_similarity(user_vector_scaled, self.feature_matrix).flatten()

        # 4. Candidate filtering mask
        mask = np.ones(len(self.catalog), dtype=bool)

        if exclude_selected:
            seed_indices = [self.track_id_to_idx[t_id] for t_id in valid_seed_ids]
            mask[seed_indices] = False

        if min_popularity is not None:
            mask &= (self.catalog["track_popularity"] >= min_popularity).values

        if genre_filter is not None:
            if isinstance(genre_filter, str):
                genre_filter = [genre_filter]
            gf_lower = [g.lower() for g in genre_filter]
            mask &= self.catalog["genre"].str.lower().isin(gf_lower).values

        # Safeguard: Fallback if filtering produces too few candidates
        matching_indices = np.where(mask)[0]
        if len(matching_indices) == 0:
            # Relax genre and popularity constraints if 0 candidates match
            print("[Recommender Warning] No candidates matched strict filters. Relaxing filters.")
            mask = np.ones(len(self.catalog), dtype=bool)
            if exclude_selected:
                seed_indices = [self.track_id_to_idx[t_id] for t_id in valid_seed_ids]
                mask[seed_indices] = False
            matching_indices = np.where(mask)[0]

        # 5. Extract candidate scores & rank deterministically
        candidate_scores = similarities[matching_indices]
        candidate_pops = self.catalog.iloc[matching_indices]["track_popularity"].values
        candidate_ids = self.catalog.iloc[matching_indices]["track_id"].values

        # Multi-key deterministic sorting:
        # 1. Similarity score descending (-candidate_scores)
        # 2. Track popularity descending (-candidate_pops)
        # 3. Track ID ascending for deterministic tie-breaking
        sort_order = np.lexsort((candidate_ids, -candidate_pops, -candidate_scores))
        top_candidate_indices = matching_indices[sort_order[:top_n]]

        # 6. Build structured recommendation items with explainability
        recommendations = []
        for rank, row_idx in enumerate(top_candidate_indices, 1):
            row = self.catalog.iloc[row_idx]
            sim_score = float(similarities[row_idx])
            song_vector = self.feature_matrix[row_idx:row_idx+1]

            explanation = self._explain_recommendation(
                user_vector_scaled=user_vector_scaled,
                song_vector_scaled=song_vector,
                song_raw_row=row,
                user_raw_means=user_raw_means,
                user_dominant_genre=top_user_genre,
            )

            recommendations.append({
                "rank": rank,
                "track_id": str(row["track_id"]),
                "track_name": str(row.get("track_name", "Unknown")),
                "track_artist": str(row.get("track_artist", "Unknown")),
                "track_popularity": int(row.get("track_popularity", 0)),
                "genre": str(row.get("genre", "Other")),
                "subgenre": str(row.get("subgenre", "Other")),
                "similarity_score": round(sim_score, 4),
                "similarity_percentage": round(sim_score * 100.0, 1),
                "audio_features": {
                    feat: round(float(row[feat]), 3) for feat in self.feature_cols if feat in row
                },
                "explanation": explanation,
            })

        return {
            "query_summary": {
                "seed_track_count": len(valid_seed_ids),
                "requested_top_n": top_n,
                "returned_count": len(recommendations),
                "genre_filter": genre_filter,
                "min_popularity": min_popularity,
            },
            "user_profile": profile_dict,
            "recommendations": recommendations,
        }

    def search_tracks(self, query: str, limit: int = 10) -> List[Dict[str, Any]]:
        """
        Helper method to search tracks by name or artist (for UI seed selection).
        """
        q = query.lower().strip()
        matched = self.catalog[
            self.catalog["track_name"].str.lower().str.contains(q, na=False)
            | self.catalog["track_artist"].str.lower().str.contains(q, na=False)
        ].sort_values("track_popularity", ascending=False).head(limit)

        results = []
        for _, r in matched.iterrows():
            results.append({
                "track_id": r["track_id"],
                "track_name": r["track_name"],
                "track_artist": r["track_artist"],
                "track_popularity": int(r["track_popularity"]),
                "genre": r.get("genre", "Other"),
                "subgenre": r.get("subgenre", "Other"),
                "energy": round(float(r.get("energy", 0)), 3),
                "danceability": round(float(r.get("danceability", 0)), 3),
                "valence": round(float(r.get("valence", 0)), 3),
            })
        return results

"""
Unit Tests for MusicLens Recommendation & User Profiling Engine
================================================================
Validates feature preparation, normalization scalers, similarity
calculations, ranking monotonicity, duplicate exclusions, empty/invalid inputs,
user profiling, and explainability payloads.
"""

import pytest
import numpy as np
import pandas as pd
from sklearn.preprocessing import StandardScaler

from pipeline.config import RECOMMENDATION_FEATURES
from pipeline.utils.feature_engineering import (
    AudioFeatureScaler,
    engineer_audio_features,
    categorize_mood,
    categorize_tempo,
)
from pipeline.utils.user_profile import (
    UserMusicProfile,
    determine_personality_archetype,
)
from pipeline.utils.recommender import ContentBasedRecommender


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def sample_catalog_data():
    """Generates synthetic track and audio feature datasets for isolated testing."""
    np.random.seed(42)
    n_tracks = 50

    tracks_data = {
        "track_id": [f"track_{i:03d}" for i in range(n_tracks)],
        "track_name": [f"Song {i}" for i in range(n_tracks)],
        "track_artist": [f"Artist {i % 10}" for i in range(n_tracks)],
        "track_popularity": np.random.randint(10, 95, size=n_tracks),
        "duration_ms": np.random.randint(150000, 300000, size=n_tracks),
        "track_album_name": [f"Album {i % 5}" for i in range(n_tracks)],
    }
    tracks_df = pd.DataFrame(tracks_data)

    audio_data = {
        "track_id": [f"track_{i:03d}" for i in range(n_tracks)],
        "danceability": np.random.uniform(0.2, 0.95, size=n_tracks),
        "energy": np.random.uniform(0.1, 0.99, size=n_tracks),
        "loudness": np.random.uniform(-25.0, -2.0, size=n_tracks),
        "speechiness": np.random.uniform(0.02, 0.45, size=n_tracks),
        "acousticness": np.random.uniform(0.01, 0.95, size=n_tracks),
        "instrumentalness": np.random.uniform(0.0, 0.8, size=n_tracks),
        "liveness": np.random.uniform(0.05, 0.7, size=n_tracks),
        "valence": np.random.uniform(0.1, 0.95, size=n_tracks),
        "tempo": np.random.uniform(70.0, 180.0, size=n_tracks),
        "key": np.random.randint(0, 11, size=n_tracks),
        "mode": np.random.randint(0, 2, size=n_tracks),
    }
    audio_df = pd.DataFrame(audio_data)

    playlist_data = {
        "track_id": [f"track_{i:03d}" for i in range(n_tracks)],
        "playlist_id": [f"pl_{i % 5}" for i in range(n_tracks)],
        "playlist_genre": [["pop", "rap", "rock", "latin", "edm", "r&b"][i % 6] for i in range(n_tracks)],
        "playlist_subgenre": [f"sub_{i % 12}" for i in range(n_tracks)],
    }
    pt_df = pd.DataFrame(playlist_data)

    return tracks_df, audio_df, pt_df


@pytest.fixture
def recommender(sample_catalog_data):
    tracks_df, audio_df, pt_df = sample_catalog_data
    return ContentBasedRecommender(
        tracks_df=tracks_df,
        audio_features_df=audio_df,
        playlist_tracks_df=pt_df,
        feature_cols=RECOMMENDATION_FEATURES,
    )


# ---------------------------------------------------------------------------
# 1. Feature Preparation & Engineering Tests
# ---------------------------------------------------------------------------

class TestFeaturePreparation:
    def test_all_recommendation_features_present(self, sample_catalog_data):
        _, audio_df, _ = sample_catalog_data
        for col in RECOMMENDATION_FEATURES:
            assert col in audio_df.columns
            assert audio_df[col].isnull().sum() == 0

    def test_engineered_audio_features_columns(self, sample_catalog_data):
        tracks_df, audio_df, _ = sample_catalog_data
        merged = tracks_df.merge(audio_df, on="track_id")
        enriched = engineer_audio_features(merged, feature_cols=RECOMMENDATION_FEATURES)

        assert "mood_quadrant" in enriched.columns
        assert "tempo_bracket" in enriched.columns
        assert "dance_energy_index" in enriched.columns
        assert "acoustic_energy_balance" in enriched.columns

    def test_mood_quadrant_classification(self):
        assert categorize_mood(0.8, 0.8) == "Upbeat / Euphoric"
        assert categorize_mood(0.8, 0.3) == "Chill / Peaceful"
        assert categorize_mood(0.2, 0.8) == "Intense / Aggressive"
        assert categorize_mood(0.2, 0.2) == "Melancholic / Sad"

    def test_tempo_categorization(self):
        assert categorize_tempo(75.0) == "Slow (<90 BPM)"
        assert categorize_tempo(110.0) == "Mid-tempo (90-130 BPM)"
        assert categorize_tempo(145.0) == "Fast (>130 BPM)"


# ---------------------------------------------------------------------------
# 2. Normalization & Scaler Tests
# ---------------------------------------------------------------------------

class TestNormalization:
    def test_standard_scaler_mean_and_variance(self, sample_catalog_data):
        _, audio_df, _ = sample_catalog_data
        scaler = AudioFeatureScaler(feature_cols=RECOMMENDATION_FEATURES, scaler_type="standard")
        scaled = scaler.fit_transform(audio_df)

        assert scaled.shape == (len(audio_df), len(RECOMMENDATION_FEATURES))
        # Zero mean and unit variance check
        np.testing.assert_allclose(scaled.mean(axis=0), 0.0, atol=1e-5)
        np.testing.assert_allclose(scaled.std(axis=0), 1.0, atol=1e-5)

    def test_minmax_scaler_bounds(self, sample_catalog_data):
        _, audio_df, _ = sample_catalog_data
        scaler = AudioFeatureScaler(feature_cols=RECOMMENDATION_FEATURES, scaler_type="minmax")
        scaled = scaler.fit_transform(audio_df)

        assert scaled.min() >= -1e-7
        assert scaled.max() <= 1.0 + 1e-7

    def test_scaler_persistence(self, sample_catalog_data, tmp_path):
        _, audio_df, _ = sample_catalog_data
        scaler = AudioFeatureScaler(feature_cols=RECOMMENDATION_FEATURES, scaler_type="standard")
        scaled_original = scaler.fit_transform(audio_df)

        save_path = tmp_path / "scaler_test.joblib"
        scaler.save(str(save_path))
        loaded_scaler = AudioFeatureScaler.load(str(save_path))

        scaled_loaded = loaded_scaler.transform(audio_df)
        np.testing.assert_array_equal(scaled_original, scaled_loaded)


# ---------------------------------------------------------------------------
# 3. Similarity Calculation & User Vector Tests
# ---------------------------------------------------------------------------

class TestSimilarityCalculation:
    def test_identical_vector_similarity_is_one(self, recommender):
        # A seed track compared to itself in feature space must yield 1.0
        seed_id = "track_001"
        u_vec, _ = recommender.build_user_vector([seed_id])
        rec_res = recommender.recommend([seed_id], top_n=5, exclude_selected=False)

        top_rec = rec_res["recommendations"][0]
        assert top_rec["track_id"] == seed_id
        assert np.isclose(top_rec["similarity_score"], 1.0, atol=1e-4)

    def test_weighted_user_vector(self, recommender):
        u_vec_equal, _ = recommender.build_user_vector(["track_001", "track_002"], weights=[1.0, 1.0])
        u_vec_weighted, _ = recommender.build_user_vector(["track_001", "track_002"], weights=[10.0, 0.1])

        idx1 = recommender.track_id_to_idx["track_001"]
        vec1 = recommender.feature_matrix[idx1]

        # Heavy weight on track_001 makes user vector extremely close to track_001's vector
        diff_weighted = np.linalg.norm(u_vec_weighted.flatten() - vec1)
        diff_equal = np.linalg.norm(u_vec_equal.flatten() - vec1)
        assert diff_weighted < diff_equal


# ---------------------------------------------------------------------------
# 4. Recommendation Ranking & Monotonicity Tests
# ---------------------------------------------------------------------------

class TestRecommendationRanking:
    def test_monotonic_descending_ranking(self, recommender):
        seed_ids = ["track_001", "track_002"]
        res = recommender.recommend(seed_ids, top_n=10)
        recs = res["recommendations"]

        assert len(recs) == 10
        scores = [r["similarity_score"] for r in recs]
        for i in range(len(scores) - 1):
            assert scores[i] >= scores[i + 1], f"Rank {i} score ({scores[i]}) is less than Rank {i+1} score ({scores[i+1]})"

    def test_deterministic_output(self, recommender):
        seed_ids = ["track_005", "track_010"]
        res1 = recommender.recommend(seed_ids, top_n=8)
        res2 = recommender.recommend(seed_ids, top_n=8)

        ids1 = [r["track_id"] for r in res1["recommendations"]]
        ids2 = [r["track_id"] for r in res2["recommendations"]]
        scores1 = [r["similarity_score"] for r in res1["recommendations"]]
        scores2 = [r["similarity_score"] for r in res2["recommendations"]]

        assert ids1 == ids2
        assert scores1 == scores2


# ---------------------------------------------------------------------------
# 5. Duplicate & Seed Exclusion Safeguard Tests
# ---------------------------------------------------------------------------

class TestSafeguards:
    def test_seed_exclusion(self, recommender):
        seed_ids = ["track_003", "track_007", "track_012"]
        res = recommender.recommend(seed_ids, top_n=15, exclude_selected=True)
        rec_ids = [r["track_id"] for r in res["recommendations"]]

        for s in seed_ids:
            assert s not in rec_ids, f"Seed track {s} was erroneously found in recommendations."

    def test_no_duplicate_recommendations(self, recommender):
        seed_ids = ["track_002", "track_004"]
        res = recommender.recommend(seed_ids, top_n=20)
        rec_ids = [r["track_id"] for r in res["recommendations"]]

        assert len(rec_ids) == len(set(rec_ids)), "Duplicate track IDs found in recommendation list."

    def test_top_n_respects_requested_limit(self, recommender):
        seed_ids = ["track_001"]
        for n in [1, 3, 7, 12]:
            res = recommender.recommend(seed_ids, top_n=n)
            assert len(res["recommendations"]) == n


# ---------------------------------------------------------------------------
# 6. Edge Cases & Error Handling Tests
# ---------------------------------------------------------------------------

class TestEdgeCasesAndValidation:
    def test_empty_seed_tracks_raises_error(self, recommender):
        with pytest.raises(ValueError):
            recommender.recommend([])

    def test_unrecognized_seed_tracks_raises_error(self, recommender):
        with pytest.raises(ValueError):
            recommender.recommend(["non_existent_track_xyz_999"])

    def test_partial_unrecognized_seeds_graceful(self, recommender):
        # Mix of 1 real track and 1 fake track should succeed using the real track
        res = recommender.recommend(["track_001", "non_existent_fake_track_123"], top_n=5)
        assert len(res["recommendations"]) == 5
        assert res["query_summary"]["seed_track_count"] == 1

    def test_invalid_top_n_raises_error(self, recommender):
        with pytest.raises(ValueError):
            recommender.recommend(["track_001"], top_n=0)
        with pytest.raises(ValueError):
            recommender.recommend(["track_001"], top_n=-5)


# ---------------------------------------------------------------------------
# 7. User Profiling & Personality Archetype Tests
# ---------------------------------------------------------------------------

class TestUserMusicProfile:
    def test_profile_metrics_calculation(self, sample_catalog_data):
        tracks_df, audio_df, pt_df = sample_catalog_data
        seed_ids = ["track_000", "track_001", "track_002"]

        profile = UserMusicProfile(
            seed_track_ids=seed_ids,
            seed_tracks_df=tracks_df,
            audio_features_df=audio_df,
            playlist_tracks_df=pt_df,
        )
        p_dict = profile.to_dict()

        assert p_dict["seed_count"] == 3
        assert p_dict["valid_tracks_analyzed"] == 3
        assert "archetype" in p_dict
        assert "audio_profile" in p_dict

        ap = p_dict["audio_profile"]
        assert 0.0 <= ap["energy_pct"] <= 100.0
        assert 0.0 <= ap["danceability_pct"] <= 100.0
        assert 0.0 <= ap["valence_pct"] <= 100.0

    def test_personality_archetypes_coverage(self):
        high_energy_party = {"energy": 0.85, "danceability": 0.80, "valence": 0.70}
        assert determine_personality_archetype(high_energy_party)["archetype"] == "High-Energy Party Enthusiast"

        acoustic_soul = {"energy": 0.30, "danceability": 0.40, "acousticness": 0.75, "valence": 0.40}
        assert determine_personality_archetype(acoustic_soul)["archetype"] == "Acoustic & Introspective Soul"

        euphoric_groove = {"energy": 0.65, "danceability": 0.75, "valence": 0.80}
        assert determine_personality_archetype(euphoric_groove)["archetype"] == "Euphoric Groove Explorer"


# ---------------------------------------------------------------------------
# 8. Explainability Output Structure Tests
# ---------------------------------------------------------------------------

class TestExplainabilityPayload:
    def test_explanation_contains_required_fields(self, recommender):
        res = recommender.recommend(["track_001", "track_002"], top_n=5)
        for rec in res["recommendations"]:
            assert "explanation" in rec
            exp = rec["explanation"]
            assert "top_matching_features" in exp
            assert len(exp["top_matching_features"]) == 3
            assert "explanation_text" in exp
            assert isinstance(exp["explanation_text"], str)
            assert len(exp["explanation_text"]) > 10
            assert "feature_proximities_pct" in exp
            assert "feature_deltas" in exp

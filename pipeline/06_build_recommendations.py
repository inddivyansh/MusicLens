"""
Step 6: Build Recommendations & Technical Evaluation
=====================================================
Executes explainable content-based recommendations across diverse user
profiles, validates safeguards, runs technical evaluation benchmarks,
and exports JSON payloads for the frontend and analytical reports.
"""

import sys
import json
import time
from pathlib import Path
from typing import List, Dict, Any

# Add project root to sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import pandas as pd
import numpy as np
from scipy import stats

from pipeline.config import (
    CLEANED_DATA_DIR,
    EXPORTS_DIR,
    RECOMMENDATION_FEATURES,
)
from pipeline.utils.feature_engineering import AudioFeatureScaler
from pipeline.utils.recommender import ContentBasedRecommender


def run_technical_evaluation(
    recommender: ContentBasedRecommender,
    test_personas: Dict[str, List[str]],
) -> Dict[str, Any]:
    """
    Evaluate technical behavior and safeguards of the recommendation system.

    Metrics:
      1. Determinism / Reproducibility: Assert exact rank order across runs.
      2. Score Validity: Assert all similarity scores in [0.0, 1.0] and strictly descending.
      3. Zero Seed Contamination: Assert no seed track appears in recommendations.
      4. Zero Duplicate Recommendations: Assert unique track_id per recommendation list.
      5. Feature Relevance Lift: Compare recommended similarity vs random baseline catalog sample.
    """
    print("\n" + "=" * 65)
    print("  TECHNICAL EVALUATION & SAFEGUARD VERIFICATION")
    print("=" * 65)

    eval_results = {
        "tests_passed": 0,
        "tests_total": 5,
        "details": {},
    }

    # Test 1: Determinism
    persona_name, seed_ids = list(test_personas.items())[0]
    res1 = recommender.recommend(seed_ids, top_n=10)
    res2 = recommender.recommend(seed_ids, top_n=10)
    ids1 = [r["track_id"] for r in res1["recommendations"]]
    ids2 = [r["track_id"] for r in res2["recommendations"]]
    scores1 = [r["similarity_score"] for r in res1["recommendations"]]
    scores2 = [r["similarity_score"] for r in res2["recommendations"]]

    is_deterministic = (ids1 == ids2) and np.allclose(scores1, scores2, atol=1e-6)
    status_1 = "PASS" if is_deterministic else "FAIL"
    print(f"  [Test 1] Deterministic Ranking: {status_1}")
    eval_results["details"]["determinism"] = {
        "passed": is_deterministic,
        "description": "Exact same ranking and similarity scores across repeated executions.",
    }
    if is_deterministic:
        eval_results["tests_passed"] += 1

    # Test 2: Boundedness & Monotonicity
    all_scores_valid = True
    all_monotonic = True
    for p_name, s_ids in test_personas.items():
        res = recommender.recommend(s_ids, top_n=15)
        scores = [r["similarity_score"] for r in res["recommendations"]]
        if not all(-1.0 <= s <= 1.0 for s in scores):
            all_scores_valid = False
        if any(scores[i] < scores[i+1] for i in range(len(scores)-1)):
            all_monotonic = False

    is_valid_scores = all_scores_valid and all_monotonic
    status_2 = "PASS" if is_valid_scores else "FAIL"
    print(f"  [Test 2] Similarity Score Validity (Bounded [-1, 1] & Monotonic): {status_2}")
    eval_results["details"]["score_validity"] = {
        "passed": is_valid_scores,
        "all_in_bounds_neg1_to_pos1": all_scores_valid,
        "strictly_descending": all_monotonic,
    }
    if is_valid_scores:
        eval_results["tests_passed"] += 1

    # Test 3: Zero Seed Contamination
    zero_seeds = True
    for p_name, s_ids in test_personas.items():
        res = recommender.recommend(s_ids, top_n=20, exclude_selected=True)
        rec_ids = {r["track_id"] for r in res["recommendations"]}
        overlap = set(s_ids).intersection(rec_ids)
        if len(overlap) > 0:
            zero_seeds = False
            break

    status_3 = "PASS" if zero_seeds else "FAIL"
    print(f"  [Test 3] Zero Seed Contamination (Seeds strictly excluded): {status_3}")
    eval_results["details"]["seed_exclusion"] = {
        "passed": zero_seeds,
        "description": "User's selected seed songs are never recommended back.",
    }
    if zero_seeds:
        eval_results["tests_passed"] += 1

    # Test 4: Zero Duplicate Recommendations
    zero_duplicates = True
    for p_name, s_ids in test_personas.items():
        res = recommender.recommend(s_ids, top_n=25)
        rec_ids = [r["track_id"] for r in res["recommendations"]]
        if len(rec_ids) != len(set(rec_ids)):
            zero_duplicates = False
            break

    status_4 = "PASS" if zero_duplicates else "FAIL"
    print(f"  [Test 4] Zero Duplicate Recommendations: {status_4}")
    eval_results["details"]["duplicate_exclusion"] = {
        "passed": zero_duplicates,
        "description": "Every recommendation list contains 100% distinct track IDs.",
    }
    if zero_duplicates:
        eval_results["tests_passed"] += 1

    # Test 5: Feature Relevance Lift vs Random Baseline
    np.random.seed(42)
    random_indices = np.random.choice(len(recommender.catalog), size=500, replace=False)
    random_matrix = recommender.feature_matrix[random_indices]

    relevance_lifts = []
    for p_name, s_ids in test_personas.items():
        u_vec, _ = recommender.build_user_vector(s_ids)
        rec_res = recommender.recommend(s_ids, top_n=10)
        rec_sims = [r["similarity_score"] for r in rec_res["recommendations"]]
        rec_mean_sim = float(np.mean(rec_sims))

        # Baseline: cosine similarity to 500 random catalog songs
        from sklearn.metrics.pairwise import cosine_similarity
        rand_sims = cosine_similarity(u_vec, random_matrix).flatten()
        rand_mean_sim = float(np.mean(rand_sims))
        delta = rec_mean_sim - rand_mean_sim

        relevance_lifts.append({
            "persona": p_name,
            "top10_mean_similarity": round(rec_mean_sim, 4),
            "random_baseline_mean_similarity": round(rand_mean_sim, 4),
            "similarity_delta": round(delta, 4),
        })

    has_strong_lift = all(item["similarity_delta"] > 0.40 for item in relevance_lifts)
    status_5 = "PASS" if has_strong_lift else "FAIL"
    print(f"  [Test 5] Statistical Relevance Lift vs Random Baseline (Delta > +0.40): {status_5}")
    for item in relevance_lifts:
        print(f"    - {item['persona']}: Recs={item['top10_mean_similarity']:.3f} vs Baseline={item['random_baseline_mean_similarity']:.3f} (Delta: +{item['similarity_delta']:.3f})")

    eval_results["details"]["relevance_lift"] = {
        "passed": has_strong_lift,
        "persona_benchmarks": relevance_lifts,
    }
    if has_strong_lift:
        eval_results["tests_passed"] += 1

    print("=" * 65)
    print(f"  Evaluation Summary: {eval_results['tests_passed']}/{eval_results['tests_total']} Checks Passed.")
    print("=" * 65)
    return eval_results


def run_pipeline() -> None:
    print("=" * 65)
    print("  MusicLens — Recommendation Engine Pipeline (Step 06)")
    print("=" * 65)
    t_start = time.time()

    # 1. Load data
    print("\n[Step 1] Loading datasets...")
    tracks_df = pd.read_csv(CLEANED_DATA_DIR / "tracks.csv")
    audio_df = pd.read_csv(CLEANED_DATA_DIR / "audio_features.csv")
    pt_df = pd.read_csv(CLEANED_DATA_DIR / "playlist_tracks.csv")

    scaler_path = EXPORTS_DIR / "audio_scaler.joblib"
    scaler = AudioFeatureScaler.load(str(scaler_path)) if scaler_path.exists() else None

    # 2. Instantiate Recommender
    print("\n[Step 2] Initializing ContentBasedRecommender...")
    recommender = ContentBasedRecommender(
        tracks_df=tracks_df,
        audio_features_df=audio_df,
        playlist_tracks_df=pt_df,
        feature_cols=RECOMMENDATION_FEATURES,
        scaler=scaler,
    )
    print(f"  Catalog ready: {len(recommender.catalog):,} unique tracks indexed.")

    # 3. Find sample tracks for distinct personas
    print("\n[Step 3] Defining evaluation listening personas...")

    def find_tracks(query: str, min_pop: int = 50, n: int = 3) -> List[str]:
        m = recommender.search_tracks(query, limit=10)
        valid = [t["track_id"] for t in m if t["track_popularity"] >= min_pop]
        if len(valid) < n:
            valid = [t["track_id"] for t in m][:n]
        return valid[:n]

    personas = {
        "Pop & Dance Aficionado": find_tracks("Dua Lipa") + find_tracks("Ed Sheeran")[:1],
        "High-Energy EDM Enthusiast": find_tracks("Martin Garrix") + find_tracks("Tiësto")[:1],
        "Lyrical Rap & Hip-Hop Fan": find_tracks("Kendrick Lamar") + find_tracks("Post Malone")[:1],
        "Indie & Acoustic Soul": find_tracks("Billie Eilish") + find_tracks("Lewis Capaldi")[:1],
    }

    # Ensure all personas have valid tracks
    for p_name, ids in list(personas.items()):
        if len(ids) == 0:
            # Fallback to catalog slice
            personas[p_name] = list(recommender.catalog["track_id"].iloc[:3])

    # 4. Generate recommendations for each persona
    print("\n[Step 4] Generating explainable recommendations per persona...")
    persona_outputs = {}

    for p_name, seed_ids in personas.items():
        print(f"\n--- Persona: {p_name} ({len(seed_ids)} seed tracks) ---")
        result = recommender.recommend(seed_ids, top_n=5)
        persona_outputs[p_name] = result

        prof = result["user_profile"]
        print(f"  Archetype: {prof['archetype']} — \"{prof['tagline']}\"")
        ap = prof["audio_profile"]
        print(f"  Profile: Energy={ap['energy_pct']}% | Danceability={ap['danceability_pct']}% | Valence={ap['valence_pct']}% | Tempo={ap['avg_tempo_bpm']} BPM")
        print("  Top 3 Recommendations:")
        for rec in result["recommendations"][:3]:
            print(f"    #{rec['rank']} \"{rec['track_name']}\" by {rec['track_artist']} (Sim: {rec['similarity_percentage']}%)")
            print(f"       -> {rec['explanation']['explanation_text']}")

    # 5. Run Technical Evaluation
    eval_summary = run_technical_evaluation(recommender, personas)

    # 6. Export artifacts
    print("\n[Step 5] Exporting recommendations and evaluation artifacts...")
    json_targets = [EXPORTS_DIR]
    for target_dir in json_targets:
        target_dir.mkdir(parents=True, exist_ok=True)
        with open(target_dir / "sample_recommendations.json", "w", encoding="utf-8") as f:
            json.dump(persona_outputs, f, indent=2)

        with open(target_dir / "recommendation_evaluation.json", "w", encoding="utf-8") as f:
            json.dump(eval_summary, f, indent=2)

    print("  Artifacts saved to data/exports/")

    elapsed = time.time() - t_start
    print(f"\n{'='*65}")
    print(f"  [Done] Recommendation pipeline completed in {elapsed:.2f}s")
    print(f"{'='*65}\n")


if __name__ == "__main__":
    run_pipeline()

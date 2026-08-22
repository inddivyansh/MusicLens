# MusicLens — Offline Recommendation Evaluation Framework

Phase 3 of the MusicLens ML upgrade. Replaces the five behavioural
correctness checks in `pipeline/06_build_recommendations.py` with a
proper offline evaluation framework that measures *recommendation quality*
against held-out data across three directly comparable recommenders.

---

## Table of Contents

1. [Evaluation Protocol](#1-evaluation-protocol)
2. [Leakage Prevention](#2-leakage-prevention)
3. [Metrics Reference](#3-metrics-reference)
4. [Baselines and Model](#4-baselines-and-model)
5. [System Correctness Checks](#5-system-correctness-checks)
6. [How to Run](#6-how-to-run)
7. [Output Files](#7-output-files)
8. [Interpreting Results](#8-interpreting-results)
9. [Limitations](#9-limitations)

---

## 1. Evaluation Protocol

### Data Availability

The MusicLens dataset is a **static Spotify catalog snapshot** of ~28,000
tracks. It does **not** contain a per-user interaction log with real
listening timestamps. The only temporal signal available is:

| Column | Location | Meaning |
|---|---|---|
| `release_year` | `data/cleaned/tracks.parquet` | Album release year (int) |
| `release_month` | `data/cleaned/tracks.parquet` | Album release month (1–12) |

These are album metadata, not user listening timestamps.

### Temporal Catalog Split

The framework uses a **temporal catalog split** on `release_year`:

```
tracks with release_year < CUTOFF_YEAR  →  PROFILE partition  (past catalog)
tracks with release_year >= CUTOFF_YEAR →  HELD-OUT partition (future catalog)
```

Default cutoff: **2019**. This gives approximately 80 % profile / 20 %
held-out on the 30k dataset.

This mirrors real temporal evaluation:

```
PAST  → used to build user profiles and fit scalers
FUTURE → used as ground-truth candidates only
```

The split is implemented in `dataset_split.py::TemporalCatalogSplit`.

### Synthetic Evaluation Personas

Because no real user interaction log exists, the framework constructs
**synthetic pseudo-users** (personas):

1. Sample `seeds_per_persona` tracks from the **profile** partition.
   With `genre_stratified=True` (default), each persona is anchored to
   a single playlist genre so listening patterns are realistic.
2. Compute a mean audio feature vector from the seed tracks (scaled with
   profile-only statistics).
3. Find the `ground_truth_k` most similar tracks in the **held-out**
   partition by cosine similarity. These become the ground-truth set.
4. Store cosine similarity as a graded relevance signal (used by nDCG).

Each persona is validated: no seed track ID may appear in its ground-truth
set. This is enforced in `EvaluationPersona.__post_init__`.

**Default settings:**

| Parameter | Default | CLI flag |
|---|---|---|
| `n_personas` | 20 | `--n-personas` |
| `seeds_per_persona` | 5 | `--seeds` |
| `ground_truth_k` | 50 | `--ground-truth-k` |
| `cutoff_year` | 2019 | `--cutoff-year` |

---

## 2. Leakage Prevention

Every leakage risk is explicitly addressed:

| Risk | Mitigation |
|---|---|
| Future tracks in profile | `release_year < cutoff_year` is strictly enforced. `CatalogSplitResult.validate_no_leakage()` asserts zero track overlap. |
| Scaler fitted on full catalog | `fit_scaler_on_profile=True` (default) re-fits `StandardScaler` on the profile partition only. The production `audio_scaler.joblib` artifact is NOT used by default. |
| PCA components leaking held-out structure | PCA components are loaded from `ml/artifacts/preprocessing.json` (trained on full catalog), but PCA components capture *feature covariance structure*, not label information. The scaler that feeds the PCA is re-fitted on profile data. |
| Seeds from held-out | Seeds are sampled exclusively from `split.profile_tracks`. |
| Ground truth from profile | Ground truth tracks come exclusively from `split.held_out_tracks`. |
| Seed / ground-truth overlap | `EvaluationPersona.__post_init__` raises `ValueError` on overlap. |
| Recommenders seeing held-out during fit | Each adapter's `.fit(profile_catalog)` only receives `split.profile_tracks`. The held-out catalog is passed to `.recommend()` as the candidate pool — ranking only, no fitting. |

The split manifest (`split_manifest.json`) records a SHA-256 prefix of all
catalog track IDs for reproducibility verification.

---

## 3. Metrics Reference

All metrics are implemented in `metrics.py` with no hardcoded thresholds.

### Ranking Quality Metrics (per-user, then macro-averaged)

| Metric | Symbol | Definition |
|---|---|---|
| **Precision@K** | P@K | `|{top-K recs} ∩ relevant| / K` |
| **Recall@K** | R@K | `|{top-K recs} ∩ relevant| / |relevant|` |
| **HitRate@K** | HR@K | `1` if any relevant item in top K, else `0` |
| **nDCG@K** | nDCG@K | Normalised DCG with log-base-2 discounting. Supports graded relevance (cosine similarity scores). IDCG computed over top-K relevant items by score. |
| **AP@K** | AP@K | `(1 / min(|R|, K)) × Σ P@i × rel(i)` for i=1…K |

MAP@K is the macro-mean of AP@K across all users.

### Diversity and Coverage Metrics (catalog-level)

| Metric | Symbol | Definition |
|---|---|---|
| **Catalog Coverage@K** | CatCov@K | `|unique items recommended| / |held-out catalog|` |
| **Artist Coverage@K** | ArtCov@K | `|unique artists recommended| / |held-out artists|` |
| **Intra-List Diversity** | ILD | Mean pairwise cosine *distance* (1 − cosine similarity) between audio feature vectors in a recommendation list. Range [0, 1]; higher = more varied. |
| **Novelty** | Nov | Mean self-information: `−log₂(popularity / 100)` per item. Higher = less popular / more surprising. |

### Statistical Reporting

`aggregate_metrics()` computes for each metric:

- **macro mean** — simple average across users
- **macro std** — standard deviation (ddof=1)
- **macro median, min, max**
- **95 % bootstrap CI** — 1,000 resamples of the mean (percentile method)
- **n_valid** — number of users with a non-NaN value

It also computes:

- **micro precision** — total hits / total recommendations
- **micro recall** — total hits / total ground-truth interactions

Bootstrap CIs are only computed when `n_valid >= 5` (too few users gives
meaningless CIs). Set `--n-bootstrap 0` to skip them entirely.

---

## 4. Baselines and Model

All three adapters share an identical interface:

```python
adapter.fit(profile_catalog: pd.DataFrame) -> self
adapter.recommend(seed_track_ids, candidate_pool, k) -> list[str]
adapter.describe() -> dict
```

### Baseline A — `PopularityRecommender`

Non-personalised ranking by `track_popularity` (Spotify 0–100 score),
descending. Ignores seed tracks entirely. No fitting required.

This is the weakest sensible baseline: any personalised model should
outperform it on precision/recall/nDCG. It often achieves high catalog
coverage because popular tracks are concentrated in a small set.

### Baseline B — `ContentBasedAdapter`

Mirrors the existing `pipeline/utils/recommender.py::ContentBasedRecommender`:

1. Build a **mean audio feature vector** from seed tracks.
2. Scale with `StandardScaler` fitted on the **profile catalog only**.
3. Rank candidates by **cosine similarity** to the user vector.
4. Tie-break deterministically by `track_popularity` then `track_id`.

No PCA, no genre/artist affinity, no MMR re-ranking. Isolates the
contribution of the Phase 1–2 enhancements.

### Model — `EnhancedRecommenderAdapter`

Full Phase 1–2 personalised pipeline in Python:

1. Build mean seed vector → scale (profile-fitted) → project via PCA
   (components from `ml/artifacts/preprocessing.json`).
2. Retrieve top 500 candidates by cosine similarity in **PCA space**.
3. Re-rank with weighted multi-factor scoring:

   | Factor | Weight |
   |---|---|
   | Audio similarity (normalised cosine) | 0.80 |
   | Genre affinity (seed genre match) | 0.08 |
   | Artist affinity (seed artist match) | 0.04 |
   | Popularity prior (log-normalised) | 0.02 |
   | Novelty (1 − popularity prior) | 0.06 |

4. MMR diversity re-ranking: λ=0.75, hard cap max 2 tracks per artist.

---

## 5. System Correctness Checks

The five existing checks from `pipeline/06_build_recommendations.py` are
preserved but explicitly **reclassified** as system-integrity checks, not
recommendation-quality metrics. They appear in a dedicated `safety_checks`
block in the output JSON, separate from the quality metrics.

| Check | What it tests |
|---|---|
| `seed_exclusion_rate` | No seed track appears in recommendations |
| `duplicate_free_rate` | Every recommendation list has unique track IDs |
| `score_monotonicity_rate` | Similarity scores are non-increasing in rank order |

A value of `1.0` means all personas passed; `< 1.0` indicates a system bug.
These should always be `1.0` — a failure here means the recommender has a
correctness defect, not that it has poor taste.

---

## 6. How to Run

### Prerequisites

Ensure the pipeline has been run through at least Step 4:

```powershell
# From project root
python pipeline/02_clean_data.py
python pipeline/04_feature_engineering.py   # generates enriched_tracks.parquet
python ml/training/train_taste_model.py     # generates ml/artifacts/
```

### Default Run (20 personas, K=10, cutoff 2019)

```powershell
cd C:\Users\divya\DataDrive\Projects\MusicLens
python -m ml.evaluation.evaluate
```

### With Custom Parameters

```powershell
python -m ml.evaluation.evaluate `
    --cutoff-year 2018 `
    --n-personas 30 `
    --seeds 5 `
    --ground-truth-k 50 `
    --k 10 `
    --n-bootstrap 1000 `
    --output-dir data/exports/evaluation
```

### Minimal Fast Run (for quick iteration)

```powershell
python -m ml.evaluation.evaluate `
    --n-personas 10 `
    --n-bootstrap 0 `
    --ground-truth-k 20
```

### All CLI Options

| Flag | Default | Description |
|---|---|---|
| `--cutoff-year` | 2019 | Release year split boundary |
| `--n-personas` | 20 | Number of synthetic evaluation personas |
| `--seeds` | 5 | Seed tracks per persona |
| `--ground-truth-k` | 50 | Ground-truth items per persona from held-out |
| `--k` | 10 | Rank cutoff for all metrics |
| `--no-genre-stratified` | off | Disable genre-based persona sampling |
| `--catalog` | `data/exports/enriched_tracks.parquet` | Catalog path |
| `--output-dir` | `data/exports/evaluation` | Output JSON directory |
| `--n-bootstrap` | 1000 | Bootstrap resamples (0 to skip CIs) |
| `--use-artifact-scaler` | off | Use full-catalog artifact scaler (adds minor leakage) |
| `--random-state` | 42 | Seed for persona sampling and bootstrap |

---

## 7. Output Files

All files are written to `data/exports/evaluation/`:

```
data/exports/evaluation/
├── split_manifest.json        Split provenance + all persona definitions
├── baseline_popularity.json   Full results for PopularityRecommender
├── baseline_content.json      Full results for ContentBasedAdapter
├── enhanced_model.json        Full results for EnhancedRecommenderAdapter
└── comparison.json            Side-by-side summary across all three
```

### Per-adapter JSON structure (`baseline_popularity.json` etc.)

```jsonc
{
  "recommender": { /* adapter.describe() */ },
  "evaluation_config": { /* EvalConfig */ },
  "split_summary": { /* cutoff_year, track counts, n_personas */ },
  "aggregate": {
    "n_users": 20,
    "metrics": {
      "ndcg_at_k": {
        "macro_mean": <float>,
        "macro_std":  <float>,
        "macro_median": <float>,
        "macro_min": <float>,
        "macro_max": <float>,
        "ci_lower": <float>,      // 95% bootstrap lower bound
        "ci_upper": <float>,      // 95% bootstrap upper bound
        "ci_method": "bootstrap_percentile",
        "ci_alpha": 0.05,
        "n_valid": 20
      }
      // ... same for precision_at_k, recall_at_k, hit_rate_at_k, ap_at_k,
      //     intra_list_diversity, novelty
    },
    "micro": {
      "total_hits": <int>,
      "total_ground_truth": <int>,
      "total_recommendations": <int>,
      "micro_precision": <float>,
      "micro_recall": <float>
    },
    "safety_checks": {
      "seed_exclusion_rate": <float>,     // should be 1.0
      "duplicate_free_rate": <float>,     // should be 1.0
      "score_monotonicity_rate": <float>  // should be 1.0
    },
    "catalog_coverage_at_k": <float>,
    "artist_coverage_at_k": <float>
  },
  "per_user": [
    {
      "persona_id": "<sha8>",
      "description": "pop | seeds=5 | gt_k=50 | persona_001",
      "recommender": "content_based_cosine",
      "k": 10,
      "precision_at_k": <float>,
      "recall_at_k": <float>,
      "hit_rate_at_k": <float>,
      "ndcg_at_k": <float>,
      "ap_at_k": <float>,
      "intra_list_diversity": <float>,
      "novelty": <float>,
      "seed_exclusion_rate": 1.0,
      "duplicate_free_rate": 1.0,
      "score_monotonicity_rate": 1.0
    }
    // ...
  ],
  "timing": { "fit_seconds": <float>, "total_seconds": <float> },
  "generated_at_utc": "<iso8601>"
}
```

### `comparison.json` structure

Side-by-side summary with mean ± CI for each metric across all three
recommenders. The top-level `note` field documents the evaluation protocol
and limitations.

---

## 8. Interpreting Results

### General guidance

- **nDCG@K** is the primary quality metric. It rewards placing relevant items
  at higher ranks and uses graded relevance (cosine similarity scores), so it
  is more informative than binary Precision@K alone.
- **HitRate@K** is the most lenient metric — it only checks whether *any*
  relevant item appears in the top K. Useful for understanding whether a
  recommender is at least in the right neighbourhood.
- **Recall@K** is bounded by `ground_truth_k / total_held_out` — it will
  always be small when the ground-truth set is small relative to the catalog.
- **ILD** and **Novelty** trade off against precision/recall. A recommender
  that maximises diversity by returning random items will have high ILD but
  near-zero precision. Report them alongside ranking metrics, not instead of
  them.
- **Catalog Coverage** reveals popularity bias. A recommender that consistently
  recommends the same 200 popular tracks to every user will have low coverage
  even with high per-user precision.

### What to expect

- **Baseline A (Popularity)** should have the lowest nDCG and highest catalog
  popularity on average. Its coverage is typically low (same popular songs
  surface for everyone).
- **Baseline B (Content-Based)** should outperform Baseline A on nDCG because
  it is personalised. ILD may be lower than Baseline A.
- **Model (Enhanced)** should outperform Baseline B on nDCG due to the
  multi-factor ranking and MMR diversity re-ranking. ILD should be higher than
  Baseline B because of the diversity constraint.

The framework makes these comparisons directly using the same personas, the
same ground-truth sets, and the same metrics. Bootstrap CIs indicate whether
observed differences are statistically stable across the persona sample.

### Comparing bootstrap CIs

If the 95 % CI of metric X for the Model does not overlap with the 95 % CI
for Baseline B, the difference is statistically stable across the personas
used. If they overlap, you need more personas or a different evaluation setup
before drawing strong conclusions.

---

## 9. Limitations

These limitations are fundamental to the evaluation setup and cannot be
resolved without additional data. They do not invalidate the framework, but
results must be interpreted in their context.

### No real user interaction log

The ground truth is constructed from **audio feature similarity**, not from
actual user listening behaviour. A track that is audio-similar to a user's
seeds but stylistically disliked will appear as a "relevant" item. This is an
inherent constraint of the available data.

**Implication:** Metrics measure *audio coherence* of recommendations more
than *preference satisfaction*. They are a necessary but not sufficient
condition for real-world quality.

### Static catalog — no true temporal gap

Album `release_year` approximates a temporal split, but:
- All data was collected in a single snapshot.
- "Future" tracks were present in the catalog at collection time; the model
  has seen their audio features during PCA training.
- This means the temporal split prevents leakage of *user preference labels*
  but does not fully replicate the cold-start scenario for new tracks.

### Synthetic personas, not real users

Personas are constructed algorithmically. They do not capture:
- User listening context (mood, activity, time of day).
- Explicit dislikes or negative feedback.
- Long-term preference drift.
- Social or editorial influence on listening choices.

### Ground-truth K is a hyperparameter

The number of "relevant" items per persona (`ground_truth_k`) is a design
choice, not a property of the data. Changing it will change recall values
and can affect nDCG. The default (50) is a reasonable choice for a catalog
of ~5,000 held-out tracks.

### Popularity Recommender candidate pool

The Popularity Recommender ranks the same tracks for every user. With a
small held-out pool and a large `ground_truth_k`, it may achieve
surprisingly high hit rates by accident. This is expected behaviour, not
a signal of quality.

### Bootstrap CI coverage

Bootstrap percentile CIs are asymptotically valid. With the default 20
personas the CIs are illustrative rather than tightly calibrated. Increase
`--n-personas` to 50+ for tighter intervals before making strong comparative
claims.

---

## Module Map

```
ml/evaluation/
├── __init__.py          Public surface re-exports
├── dataset_split.py     TemporalCatalogSplit, CatalogSplitResult, EvaluationPersona
├── metrics.py           All metric functions + aggregate_metrics()
├── baselines.py         PopularityRecommender, ContentBasedAdapter,
│                        EnhancedRecommenderAdapter, build_all_adapters()
├── evaluate.py          EvalConfig, run_evaluation(), run_full_comparison(), CLI
└── README.md            This file
```

The existing correctness checks in `pipeline/06_build_recommendations.py`
are preserved unchanged. They test system behaviour, not recommendation
quality, and remain the right place for regression testing of the
recommendation engine's plumbing.

# MusicLens personalized taste foundation

## Why this exists

The existing recommender is retained as the **baseline**: it averages selected tracks and scores catalog tracks with cosine similarity. That is useful for comparison, but one mean cannot distinguish recent listening from enduring taste, explicit likes, repeated plays, or source overlap.

The enhanced path builds separate long-term, recent, and liked profiles, then combines the available source profiles with configurable weights. A track is assigned to one source only (`liked > recent > long_term`) so an overlap between Spotify endpoints cannot increase its influence merely through duplication.

## Signals and weighting

`top_tracks` feeds long-term taste; `recently_played` feeds recent taste; Spotify saved tracks and in-app manual likes feed liked taste. Recent events use exponential decay, `exp(-lambda * age_days)`, with `lambda=0.08` per day by default (about an 8.7-day half-life). Missing timestamps receive neutral weight 1.0. When recent-play frequency is available, it affects within-source aggregation and is capped at 10 by configuration.

The initial source weights are all 1.0. This is an intentionally neutral, documented default—not an evidence-based claim that one source should dominate. They live in `model_config.json` with the trained artifacts, so a later offline evaluation can tune and version them.

The representation returns raw vector, per-source profile vectors, unique/recent/liked counts, effective source weights, and profile sample size. It deliberately does not manufacture a confidence percentage.

## Model choice and preprocessing

The repository contains catalog audio features but no labelled relevance events, so this phase uses deterministic PCA rather than a supervised or neural model. PCA is fit after a catalog-wide `StandardScaler`; it supplies a compact decorrelated taste embedding while preserving a transparent baseline for later evaluation.

`preprocessing.json` is the portable canonical scaler and PCA transform. It is used by training, Python inference, and both server-side recommendation modes. Neither personalized nor baseline ranking fits a scaler from a filtered candidate set.

## Train locally

From the repository root, after the existing data pipeline has generated the enriched catalog:

```powershell
py -3.12 -m pip install -r requirements.txt
py -3.12 -m ml.training.train_taste_model --input data/exports/enriched_tracks.parquet
```

The command writes these artifacts under `ml/artifacts/`:

- `taste_model.joblib` — Python model for offline/Python inference.
- `preprocessing.json` — portable scaler/PCA parameters for ranking.
- `model_config.json` — feature, model, and taste-aggregation configuration.
- `feature_metadata.json` — input fingerprint and training metadata.

## Inference

Use `ml.inference.user_embedding.create_user_embedding` with `TasteSignal` values. In the deployed server, the same source-aware aggregation is implemented in JavaScript because Spotify requests and ranking run in Node; it consumes the exact persisted preprocessing artifact rather than refitting it.

## Recommendation retrieval and ranking

The personalized server recommender is deliberately staged:

1. Retrieve a bounded candidate set with cosine similarity in the canonical PCA taste space.
2. Rank that set with configured audio similarity, genre affinity, artist affinity, popularity prior, and inverse-log popularity novelty.
3. Re-rank with maximal marginal relevance (MMR), a soft genre-repeat penalty, and an artist cap.
4. Return raw cosine similarity as `similarity_score` (a geometric score, not a probability) plus ranking, novelty, and diversity attributions.

`ml/recommendation_config.json` is the single configuration source for this pipeline. Its defaults deliberately keep audio similarity dominant and novelty/diversity modest; they are starting values for Phase 3 offline evaluation, not performance claims. The static manual-seed browser explorer remains a legacy baseline and is not the personalized server pipeline.

## Limits of phase 1

PCA is a catalog representation, not a relevance model, and no quality metric is claimed. Spotify endpoint limits, catalog matching coverage, missing timestamps, and lack of negative feedback remain constraints. Future phases should evaluate enhanced and baseline variants offline before tuning source weights or replacing the baseline.

The current recommendation view exposes macro genres but not per-track subgenre metadata, so subgenre affinity is intentionally not scored yet. `rankCandidates` is structured to accept an additional configured signal when that metadata is made available.

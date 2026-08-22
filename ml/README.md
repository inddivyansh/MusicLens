# MusicLens personalized taste foundation

## Why this exists

The existing recommender is retained as the **baseline**: it averages selected tracks and scores catalog tracks with cosine similarity. That is useful for comparison, but one mean cannot distinguish recent listening from enduring taste, explicit likes, repeated plays, or source overlap.

The enhanced path builds separate long-term, recent, and liked profiles, then combines the available source profiles with configurable weights. A track is assigned to one source only (`liked > recent > long_term`) so an overlap between Spotify endpoints cannot increase its influence merely through duplication.

## Signals and weighting (Phase 5)

`top_tracks` arrives in three Spotify time ranges — `short_term` (~4 weeks), `medium_term` (~6 months), `long_term` (~1 year). Phase 5 routes each into a separate aggregation group with its own configurable weight, rather than collapsing all top-tracks into one `long_term` bucket. This allows the profile to express that a short-term listening spike should count differently from a stable long-term preference.

The six groups and their default weights are:

| Group | Default weight |
|---|---|
| `long_term` | 1.0 |
| `medium_term` | 0.8 |
| `short_term` | 0.6 |
| `recent` (recently_played) | 1.0 |
| `liked` (liked_songs + in-app likes) | 1.2 |
| `manual` (in-app likes) | 1.2 |

**These are documented starting points, not evidence-based tuned values.** They live in `ml/artifacts/model_config.json` and can be tuned after running the Phase 3 offline evaluation without code changes.

### Temporal decay

Two exponential decay rates are used:

```
temporal_weight = exp(−λ × age_days)
```

- `recently_played` (group `recent`): λ = 0.08 per day → half-life ≈ 8.7 days.
  Recent listening is a strong short-term signal; events from last month should
  matter less than events from last week.
- `liked_songs` (group `liked`): λ = 0.005 per day → half-life ≈ 139 days.
  Explicit saves represent deliberate intent; a track saved a year ago still
  counts, but very recent saves score marginally higher.
- All `top_tracks` groups and `manual`: no decay. Top tracks are already
  time-bucketed by Spotify's own system; manual in-app likes have no ordering.
- Missing timestamps: `temporal_weight = 1.0` (never discarded).

### Frequency weighting

`interaction_count` from the paginated recently_played batch scales the
within-group contribution:

```
frequency_weight = min(interaction_count, frequency_cap)   [default cap: 10]
```

Capping at 10 prevents a single obsessively-replayed track from collapsing the
profile. Frequency weighting only affects recently_played; it is 1 for all other sources.

### Match confidence weighting

The entity-resolution pipeline (Phase 4) attaches a `confidence` score to each
matched track (1.0 = exact ID, 0.95 = normalized exact, 0.85 = variant, 0.82–0.94 = fuzzy).
Genre-inferred and default-baseline tracks receive `confidence = 0` and are
excluded from the enhanced aggregation entirely — they still count toward the
flat unweighted baseline means used for the archetype classifier.

### Composite weight per track

```
composite_weight = temporal_weight × frequency_weight × match_confidence
```

### Feature-level validity guard

Each of the 9 audio features is validated independently against its physical
bounds before aggregation. A corrupt or out-of-bounds value excludes that
specific feature value from that track's contribution — it does not discard
the track or affect other features. This means one bad loudness value cannot
corrupt the danceability estimate.

### Cross-source deduplication

A catalog track appearing in multiple groups is assigned to exactly one group
using precedence order (highest first):

```
manual → liked → recent → short_term → medium_term → long_term
```

This prevents a stable all-time favourite (appearing in liked_songs AND
long-term top tracks) from gaining extra weight through duplication.

### Profile confidence status

Based on the count of unique `catalog_track_id` values feeding the enhanced
aggregation:

| Status | Threshold | Meaning |
|---|---|---|
| `insufficient_data` | < 3 | Unreliable; insufficient catalog coverage |
| `limited` | 3–14 | Narrow signal |
| `developing` | 15–39 | Reasonable but not yet broad |
| `established` | ≥ 40 | Sufficient data for personalization |

This is a sample-size label, not a recommendation-quality claim.

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

## Recommendation retrieval and ranking (Phase 6)

The server recommendation pipeline is staged:

### 1. User vector resolution

The primary user representation is `taste_representation.raw_vector` from Phase 5 — a source-weighted, temporally-decayed aggregation across all six listening source groups. It is used when:
- `retrieval.representation_mode` is `'auto'` or `'enhanced'`
- The profile quality status meets the `min_quality_for_enhanced` threshold (default: `'developing'`)

If the enhanced vector is unavailable or quality is insufficient, the pipeline falls back in order:
```
enhanced_taste_representation
→ preference_vector (Phase 5 flat mean)
→ liked_track_average (mean of DB-loaded liked-track feature rows)
→ catalog_popularity (non-personalized, labelled clearly in response)
```

The `profile_fallback` field in the response reports which stage was used. It is present on every recommendation so the frontend can surface it for transparency.

### 2. Retrieval space

When using the enhanced path, candidates are retrieved in the canonical **PCA 8-dimensional space** (from `preprocessing.json`). The user's raw 9-feature vector is standardized with the catalog-fitted StandardScaler then projected through the PCA components. This is identical to the training path.

When using the baseline path, retrieval is in the standardized 9-feature audio space (no PCA).

In both modes, the canonically fitted scaler from `ml/artifacts/preprocessing.json` is used. No scaler is ever fitted from a request, filter, or candidate subset.

### 3. Multi-signal ranking

```
final_score =
    w_audio  × audio_score               (cosine in std audio space, normalized [0,1])
  + w_repr   × repr_score                (cosine in PCA space; same as audio in baseline)
  + w_genre  × genre_score               (smooth weighted sum over dominant_genres)
  + w_artist × artist_score              (1 if artist in user's top_artists)
  + w_pop    × popularity_score          (log-normalised Spotify popularity 0-100)
  + w_nov    × novelty_score             (1 − popularity_score)
```

Genre affinity uses a smooth weighted sum rather than binary matching:
```
genre_score = clamp( Σ_g  profile_pct_g/100 × 1(track_genre = g) )
```

This means a track matching a genre that is 60 % of the user's profile scores 0.60; a track matching only a 10 % genre scores 0.10. The previous max-only approach produced step discontinuities.

Ranking weights are in `ml/recommendation_config.json`. They are **documented starting values**, not performance claims. Run the Phase 3 evaluation to measure actual quality before adjusting them.

### 4. Diversity reranking (MMR)

```
MMR(i) = λ × relevance(i) − (1−λ) × max_cosine_to_selected − genre_penalty × repeated_genres
```

Hard cap: `max_per_artist` tracks per artist in the final list (default: 2).
Soft penalty: `genre_repeat_penalty` multiplied by the count of already-selected tracks sharing a genre.
λ = 0.72 biases toward relevance while maintaining list variety.

All MMR parameters are in `recommendation_config.json`.

### 5. History filtering

Two sequential queries build the exclusion set before candidate retrieval:
1. `user_liked_tracks` — in-app manual likes
2. `user_tracks WHERE match_status IN ('matched','ambiguous') AND match_confidence >= 0.85`

Tracks in this set are excluded in `retrieveCandidates()`. No per-track queries.

### 6. Explanation generation

Explanations are built from actual signal values. A signal is only mentioned in the narrative if its value exceeds a configured threshold. The `ranking_signals` block in each explanation exposes all six raw component scores for transparency. `representation_mode` and `profile_fallback` are included so downstream code can distinguish enhanced from baseline recommendations.

### Limits and honest constraints

Ranking weights are starting values. No improvement in recommendation quality is claimed — that requires running the Phase 3 evaluation framework and comparing the models. The PCA is a catalog representation, not a relevance model; cosine similarity in PCA space measures geometric proximity to user taste, not predicted satisfaction. Lack of negative feedback, catalog size (~28k tracks), and entity-resolution coverage remain constraints.

## Limits and honest constraints

PCA is a catalog representation, not a relevance model, and no quality metric
is claimed. Spotify endpoint limits, catalog matching coverage, missing
timestamps, and lack of negative feedback remain constraints.

The Phase 3 offline evaluation framework evaluates the enhanced and baseline
recommenders against synthetic personas derived from a temporal catalog split.
Results from that evaluation are the appropriate basis for tuning source weights
or replacing the baseline — not intuition or claimed improvements.

The current recommendation view exposes macro genres but not per-track subgenre
metadata, so subgenre affinity is not scored. `rankCandidates` is structured to
accept an additional configured signal when that metadata is available.

Source weights in `model_config.json` are intentionally equal-or-near-equal
starting points. They can be tuned without code changes once offline evaluation
results exist. Do not adjust them based on anecdotal user feedback alone.

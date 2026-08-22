/**
 * server/lib/recommender.js
 * MusicLens personalized recommendation engine (Phase 6).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PIPELINE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  generateRecommendations(userId, opts)
 *    │
 *    ├─ 1. Load persisted user profile (single query)
 *    ├─ 2. Batch history filter (single query: liked + matched user_tracks)
 *    ├─ 3. Resolve user vector — explicit cold-start fallback chain:
 *    │       enhanced taste_representation (Phase 5 weighted aggregation)
 *    │       → preference_vector (Phase 5 baseline mean)
 *    │       → liked-track mean (computed from DB rows already in memory)
 *    │       → catalog popularity fallback (non-personalized, clearly labelled)
 *    ├─ 4. Load catalog (single query, filter applied server-side)
 *    ├─ 5. retrieveCandidates()  — cosine scan in audio or PCA space
 *    ├─ 6. rankCandidates()      — 6-signal weighted score
 *    ├─ 7. rerankForDiversity()  — MMR + artist cap + genre penalty
 *    └─ 8. buildRecommendations() — per-track payload + explanation
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RANKING FORMULA  (personalized mode)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  final_score =
 *    w_audio  × audio_score          (cosine in standardized 9-feature space)
 *  + w_repr   × repr_score           (cosine in PCA 8-dim space, if available)
 *  + w_genre  × genre_score          (smooth weighted sum over dominant_genres)
 *  + w_artist × artist_score         (binary: 1 if artist in top_artists)
 *  + w_pop    × popularity_score     (log-normalised Spotify popularity 0-100)
 *  + w_nov    × novelty_score        (1 − popularity_score)
 *
 *  Weights are loaded from ml/recommendation_config.json.
 *  Sum of weights must equal 1.0; documented starting values, not tuned values.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * GENRE AFFINITY
 * ─────────────────────────────────────────────────────────────────────────────
 *  Phase 6 replaces the previous "take the max genre bucket" approach with a
 *  smooth weighted sum:
 *
 *    genre_score = clamp( Σ_g  profile_pct_g/100 × indicator(track_genre = g) )
 *
 *  where the sum runs over all genres in the track's genre_name string and
 *  profile_pct_g is the user's dominant_genres percentage for genre g.
 *  The result is in [0, 1].  A track matching a genre that is 60 % of the
 *  user's profile scores 0.60; one matching only a 10 % genre scores 0.10.
 *  This avoids the step discontinuity of binary genre flags.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EXPLANATION GENERATION
 * ─────────────────────────────────────────────────────────────────────────────
 *  Explanations are generated from the actual signal values computed during
 *  ranking, not from generic templates.  Each signal is compared against the
 *  thresholds in recommendation_config.json:
 *    - feature_alignments: top-N features with smallest standardized delta
 *    - genre_contribution: only mentioned if genre_score ≥ genre_mention_threshold
 *    - artist_contribution: only mentioned if artist_score ≥ artist_mention_threshold
 *    - novelty_contribution: only mentioned if novelty_score ≥ novelty_mention_threshold
 *    - diversity_reranking: present in personalized mode only
 *  The narrative string is constructed from the signals that actually drove
 *  the ranking, not assumed from position.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * BACKWARD COMPATIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 *  All exported function signatures are unchanged.  New fields are additive.
 *  The response shape consumed by the frontend RecommenderTab is preserved:
 *    recommendations[].rank, .track_id, .track_name, .artist_name,
 *    .genre_name, .track_popularity, .similarity_score, .relevance_score,
 *    .audio_features, .explanation
 *  The blend and recap routes do not call this module.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { getDb } = require('./db');

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const FEATURES = [
  'danceability', 'energy', 'loudness', 'speechiness',
  'acousticness', 'instrumentalness', 'liveness', 'valence', 'tempo',
];

// Quality status order — used to compare against min_quality_for_enhanced.
const QUALITY_ORDER = ['insufficient_data', 'limited', 'developing', 'established'];

// ─────────────────────────────────────────────────────────────────────────────
// Config loading (file-mtime cached; re-reads on modification)
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_RECOMMENDATION_CONFIG = Object.freeze({
  retrieval: {
    candidate_limit: 500,
    representation_mode: 'auto',
    min_quality_for_enhanced: 'developing',
  },
  ranking: {
    weights: {
      audio_similarity:          0.45,
      representation_similarity: 0.25,
      genre_affinity:            0.10,
      artist_affinity:           0.04,
      popularity_prior:          0.06,
      novelty:                   0.10,
    },
    baseline_weights: {
      audio_similarity:  0.80,
      genre_affinity:    0.08,
      artist_affinity:   0.04,
      popularity_prior:  0.02,
      novelty:           0.06,
    },
  },
  diversity: {
    mmr_lambda: 0.72,
    max_per_artist: 2,
    genre_repeat_penalty: 0.04,
    exclude_seed_artists: false,
  },
  novelty: { method: 'inverse_log_catalog_popularity' },
  history_filtering: {
    exclude_liked_tracks:        true,
    exclude_matched_tracks:      true,
    min_confidence_to_exclude:   0.85,
    history_limit:               2000,
  },
  cold_start: {
    fallback_chain: [
      'enhanced_taste_representation',
      'preference_vector',
      'liked_track_average',
      'catalog_popularity',
    ],
    popularity_fallback_limit:           20,
    popularity_fallback_min_popularity:  60,
  },
  explanation: {
    genre_mention_threshold:   0.15,
    artist_mention_threshold:  0.50,
    novelty_mention_threshold: 0.65,
    top_feature_alignments:    3,
  },
});

let _configCache = null;
let _configMtime = null;

function loadRecommendationConfig() {
  const configPath = path.join(__dirname, '..', '..', 'ml', 'recommendation_config.json');
  try {
    const stat  = fs.statSync(configPath);
    const mtime = stat.mtimeMs;
    if (_configCache && _configMtime === mtime) return _configCache;

    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    _configCache = {
      retrieval: { ...DEFAULT_RECOMMENDATION_CONFIG.retrieval, ...(raw.retrieval || {}) },
      ranking: {
        ...DEFAULT_RECOMMENDATION_CONFIG.ranking,
        ...(raw.ranking || {}),
        weights: {
          ...DEFAULT_RECOMMENDATION_CONFIG.ranking.weights,
          ...(raw.ranking?.weights || {}),
        },
        baseline_weights: {
          ...DEFAULT_RECOMMENDATION_CONFIG.ranking.baseline_weights,
          ...(raw.ranking?.baseline_weights || {}),
        },
      },
      diversity: { ...DEFAULT_RECOMMENDATION_CONFIG.diversity, ...(raw.diversity || {}) },
      novelty:   { ...DEFAULT_RECOMMENDATION_CONFIG.novelty,   ...(raw.novelty   || {}) },
      history_filtering: {
        ...DEFAULT_RECOMMENDATION_CONFIG.history_filtering,
        ...(raw.history_filtering || {}),
      },
      cold_start: {
        ...DEFAULT_RECOMMENDATION_CONFIG.cold_start,
        ...(raw.cold_start || {}),
        fallback_chain: raw.cold_start?.fallback_chain
          || DEFAULT_RECOMMENDATION_CONFIG.cold_start.fallback_chain,
      },
      explanation: {
        ...DEFAULT_RECOMMENDATION_CONFIG.explanation,
        ...(raw.explanation || {}),
      },
    };
    _configMtime = mtime;
    return _configCache;
  } catch {
    return DEFAULT_RECOMMENDATION_CONFIG;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Preprocessing artifact (file-mtime cached)
// ─────────────────────────────────────────────────────────────────────────────

let _preprocessingCache = null;
let _preprocessingMtime = null;

function loadCanonicalPreprocessing() {
  const artifactPath = path.join(__dirname, '..', '..', 'ml', 'artifacts', 'preprocessing.json');
  try {
    const stat  = fs.statSync(artifactPath);
    const mtime = stat.mtimeMs;
    if (_preprocessingCache && _preprocessingMtime === mtime) return _preprocessingCache;

    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
    if (
      !Array.isArray(artifact.feature_columns)
      || artifact.feature_columns.join('|') !== FEATURES.join('|')
      || !Array.isArray(artifact?.scaler?.mean)
      || !Array.isArray(artifact?.scaler?.scale)
      || !Array.isArray(artifact?.pca?.components)
    ) return null;

    const params = Object.fromEntries(FEATURES.map((f, i) => [f, {
      mean: Number(artifact.scaler.mean[i]),
      std:  Number(artifact.scaler.scale[i]),
    }]));
    if (Object.values(params).some(({ mean, std }) =>
      !Number.isFinite(mean) || !Number.isFinite(std) || std === 0
    )) return null;

    _preprocessingCache = { params, pcaComponents: artifact.pca.components };
    _preprocessingMtime = mtime;
    return _preprocessingCache;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Math helpers
// ─────────────────────────────────────────────────────────────────────────────

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function standardize(rawVector, params) {
  return FEATURES.map((f, i) => (rawVector[i] - params[f].mean) / params[f].std);
}

function projectPca(vector, components) {
  return components.map((comp) =>
    comp.reduce((s, c, i) => s + Number(c) * vector[i], 0)
  );
}

function clamp(v, min = 0, max = 1) { return Math.min(max, Math.max(min, v)); }
function round(v, d = 4) { const m = 10 ** d; return Math.round(v * m) / m; }

function parseJsonValue(value) {
  if (!value || typeof value === 'object') return value || null;
  try { return JSON.parse(value); } catch { return null; }
}

function normalizeName(v) { return String(v || '').trim().toLowerCase(); }

function genreSet(value) {
  return new Set(
    String(value || '').split(',').map((g) => normalizeName(g)).filter(Boolean)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Compatibility helpers (unchanged signatures, used by external callers)
// ─────────────────────────────────────────────────────────────────────────────

/** @deprecated Use loadCanonicalPreprocessing() directly */
function computeScalingParams() {
  const preprocessing = loadCanonicalPreprocessing();
  if (!preprocessing) throw new Error('Canonical recommendation preprocessing artifact is unavailable.');
  return preprocessing.params;
}

// ─────────────────────────────────────────────────────────────────────────────
// User vector resolution — explicit cold-start fallback chain
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Quality-level comparison helper.
 * Returns true if statusA is at least as good as statusB in QUALITY_ORDER.
 */
function meetsQualityThreshold(statusA, minRequired) {
  const iA = QUALITY_ORDER.indexOf(statusA);
  const iB = QUALITY_ORDER.indexOf(minRequired);
  return iA !== -1 && iB !== -1 && iA >= iB;
}

/**
 * Determine which representation mode to use given the loaded config and the
 * user's profile quality status.
 *
 * @param {string}  configuredMode  — 'auto' | 'enhanced' | 'baseline'
 * @param {string}  qualityStatus   — from taste_representation.quality.status
 * @param {string}  minQuality      — minimum quality threshold from config
 * @param {boolean} hasEnhanced     — whether enhanced vector exists and is valid
 * @returns {'enhanced' | 'baseline'}
 */
function resolveRepresentationMode(configuredMode, qualityStatus, minQuality, hasEnhanced) {
  if (!hasEnhanced) return 'baseline';
  if (configuredMode === 'enhanced') return 'enhanced';
  if (configuredMode === 'baseline') return 'baseline';
  // 'auto': use enhanced only if profile quality meets the threshold
  return meetsQualityThreshold(qualityStatus, minQuality) ? 'enhanced' : 'baseline';
}

/**
 * Resolve the user's raw 9-feature vector and report which fallback was used.
 *
 * Fallback chain (stops at first valid result):
 *   1. enhanced_taste_representation — Phase 5 weighted aggregation raw_vector
 *   2. preference_vector             — Phase 5 fallback mean vector
 *   3. liked_track_average           — mean of DB-loaded liked-track feature rows
 *   4. catalog_popularity            — signals no personalized vector available
 *
 * @param {object|null} profile     — user_profile_data row (JSONB fields as objects)
 * @param {Array}       likedRows   — audio feature rows from user_liked_tracks
 * @param {string}      modeHint    — 'personalized_recommender' | 'baseline_content_recommender'
 * @param {object}      config      — loaded recommendation config
 * @returns {{ vector: number[]|null, fallback: string, representationMode: string }}
 */
function resolveUserVector(profile, likedRows, modeHint, config) {
  const retrieval = config?.retrieval || DEFAULT_RECOMMENDATION_CONFIG.retrieval;

  // ── Try enhanced taste_representation ───────────────────────────────────
  const tasteRaw  = parseJsonValue(profile?.taste_representation);
  const enhancedV = Array.isArray(tasteRaw?.raw_vector)
    && tasteRaw.raw_vector.length === FEATURES.length
    && tasteRaw.raw_vector.every((v) => Number.isFinite(Number(v)))
    ? tasteRaw.raw_vector.map(Number)
    : null;
  const qualityStatus = tasteRaw?.quality?.status || 'insufficient_data';

  const representationMode = modeHint === 'personalized_recommender'
    ? resolveRepresentationMode(
        retrieval.representation_mode || 'auto',
        qualityStatus,
        retrieval.min_quality_for_enhanced || 'developing',
        enhancedV !== null
      )
    : 'baseline';

  if (representationMode === 'enhanced' && enhancedV) {
    return { vector: enhancedV, fallback: 'enhanced_taste_representation', representationMode };
  }

  // ── Try preference_vector ────────────────────────────────────────────────
  const prefV = parseJsonValue(profile?.preference_vector);
  const prefVector = Array.isArray(prefV)
    && prefV.length === FEATURES.length
    && prefV.every((v) => Number.isFinite(Number(v)))
    ? prefV.map(Number)
    : null;

  if (prefVector) {
    // Even in baseline mode, if enhanced was requested but quality was low,
    // report that accurately.
    const fallbackReason = enhancedV && representationMode === 'baseline'
      ? `preference_vector (enhanced available but quality='${qualityStatus}' below threshold)`
      : 'preference_vector';
    return { vector: prefVector, fallback: fallbackReason, representationMode: 'baseline' };
  }

  // ── Try liked-track average ──────────────────────────────────────────────
  if (likedRows && likedRows.length > 0) {
    const likedMean = FEATURES.map((f) =>
      likedRows.reduce((s, r) => s + Number(r[f] || 0), 0) / likedRows.length
    );
    if (likedMean.every(Number.isFinite)) {
      return { vector: likedMean, fallback: 'liked_track_average', representationMode: 'baseline' };
    }
  }

  // ── No personalized vector available ────────────────────────────────────
  return { vector: null, fallback: 'catalog_popularity', representationMode: 'baseline' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Scoring helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Smooth genre affinity score.
 *
 * For each genre token in the track's genre_name, look up the user's
 * dominant_genres percentage for that genre and accumulate.  The result is
 * clamped to [0, 1] so a track matching multiple dominant genres can't
 * score above 1.0.
 *
 * This replaces the previous "take the max" approach which created a step
 * discontinuity and could not distinguish a 60 % genre from a 10 % genre.
 *
 * @param {Set<string>} trackGenres      — normalized genre tokens from the track
 * @param {object}      dominantGenres   — { genre: pct } from user profile
 * @returns {number} in [0, 1]
 */
function smoothGenreAffinity(trackGenres, dominantGenres) {
  if (!trackGenres || trackGenres.size === 0) return 0;
  const profile = dominantGenres || {};
  let score = 0;
  for (const genre of trackGenres) {
    score += (Number(profile[genre]) || 0) / 100;
  }
  return clamp(score);
}

function popularitySignals(popularity) {
  const p = clamp(Number(popularity) / 100);
  const popularityPrior = Math.log1p(p * 100) / Math.log(101);
  return { popularityPrior, novelty: 1 - popularityPrior };
}

function rawTrackVector(track) {
  const v = FEATURES.map((f) => Number(track[f]));
  return v.every(Number.isFinite) ? v : null;
}

function transformForMode(rawVector, context) {
  const standardized = standardize(rawVector, context.preprocessing.params);
  return context.representationMode === 'enhanced'
    ? projectPca(standardized, context.preprocessing.pcaComponents)
    : standardized;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 1 — Candidate retrieval
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Linear scan of the in-memory catalog.  Returns up to candidate_limit tracks
 * ranked by primary cosine similarity (audio space for baseline, PCA space for
 * enhanced).  History exclusion is applied here to avoid scoring excluded tracks.
 */
function retrieveCandidates(catalog, context) {
  const retrieved = [];

  for (const track of catalog) {
    if (context.excludeTrackIds.has(track.track_id)) continue;
    if (context.excludeArtistNames.has(normalizeName(track.artist_name))) continue;

    const rawVector = rawTrackVector(track);
    if (!rawVector) continue;

    // Primary retrieval space: PCA (enhanced) or standardized audio (baseline)
    const vector         = transformForMode(rawVector, context);
    const rawSimilarity  = cosineSimilarity(context.userVector, vector);

    // Secondary: audio-space cosine always computed for the audio_score signal
    // (in enhanced mode the primary vector is PCA; we still want raw audio sim)
    const stdVector      = context.representationMode === 'enhanced'
      ? standardize(rawVector, context.preprocessing.params)
      : vector; // already standardized in baseline mode
    const audioSimilarity = context.representationMode === 'enhanced'
      ? cosineSimilarity(context.userAudioVector, stdVector)
      : rawSimilarity;

    retrieved.push({
      track,
      rawVector,
      vector,
      stdVector,
      raw_similarity:      rawSimilarity,
      audio_similarity:    audioSimilarity,
      normalized_similarity: clamp((rawSimilarity + 1) / 2),
      track_genres:        genreSet(track.genre_name),
    });
  }

  retrieved.sort((a, b) =>
    b.raw_similarity - a.raw_similarity
    || Number(b.track.track_popularity || 0) - Number(a.track.track_popularity || 0)
    || String(a.track.track_id).localeCompare(String(b.track.track_id))
  );

  const limit = Math.max(
    context.limit,
    Number(context.config.retrieval.candidate_limit) || 500
  );
  return retrieved.slice(0, limit);
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 2 — Multi-signal ranking
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rank retrieved candidates using the 6-signal weighted formula.
 * Weights come from config.ranking.weights (personalized) or
 * config.ranking.baseline_weights (baseline mode).
 */
function rankCandidates(candidates, context) {
  const weights = context.isPersonalized
    ? context.config.ranking.weights
    : context.config.ranking.baseline_weights;

  const ranked = candidates.map((c) => {
    const genreScore  = smoothGenreAffinity(c.track_genres, context.dominantGenres);
    const artists     = parseJsonValue(context.topArtists) || [];
    const artistSet   = new Set(
      artists.map((a) => normalizeName(a.artist || a.artist_name))
    );
    const artistScore = artistSet.has(normalizeName(c.track.artist_name)) ? 1 : 0;
    const { popularityPrior, novelty } = popularitySignals(c.track.track_popularity);

    // Representation similarity: PCA-space cosine (normalized to [0,1]) in
    // enhanced mode; falls back to audio similarity in baseline mode.
    const reprScore = context.isPersonalized
      ? clamp((c.raw_similarity + 1) / 2)
      : clamp((c.audio_similarity + 1) / 2);

    // Audio similarity: standardized-space cosine, normalized to [0,1]
    const audioScore = clamp((c.audio_similarity + 1) / 2);

    const relevanceScore = (
      (weights.audio_similarity          ?? 0) * audioScore
    + (weights.representation_similarity ?? 0) * reprScore
    + (weights.genre_affinity            ?? 0) * genreScore
    + (weights.artist_affinity           ?? 0) * artistScore
    + (weights.popularity_prior          ?? 0) * popularityPrior
    + (weights.novelty                   ?? 0) * novelty
    );

    return {
      ...c,
      relevance_score: relevanceScore,
      signals: {
        audio_similarity:          c.audio_similarity,
        representation_similarity: c.raw_similarity,
        audio_score:               audioScore,
        repr_score:                reprScore,
        genre_affinity:            genreScore,
        artist_affinity:           artistScore,
        popularity_prior:          popularityPrior,
        novelty,
      },
    };
  });

  ranked.sort((a, b) =>
    b.relevance_score - a.relevance_score
    || b.signals.audio_similarity - a.signals.audio_similarity
    || String(a.track.track_id).localeCompare(String(b.track.track_id))
  );

  return ranked;
}

/**
 * Baseline ranking path: audio cosine only, deterministic tie-break.
 * Kept for backward compatibility and for the evaluation baseline adapter.
 */
function rankBaselineCandidates(candidates) {
  return candidates.map((c) => ({
    ...c,
    relevance_score: c.normalized_similarity,
    signals: {
      audio_similarity:          c.raw_similarity,
      representation_similarity: c.raw_similarity,
      audio_score:               c.normalized_similarity,
      repr_score:                c.normalized_similarity,
      genre_affinity:            0,
      artist_affinity:           0,
      popularity_prior:          0,
      novelty:                   0,
    },
  })).sort((a, b) =>
    b.raw_similarity - a.raw_similarity
    || Number(b.track.track_popularity || 0) - Number(a.track.track_popularity || 0)
    || String(a.track.track_id).localeCompare(String(b.track.track_id))
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 3 — MMR diversity reranking
// ─────────────────────────────────────────────────────────────────────────────

function sharedGenreCount(candidate, selected) {
  return selected.reduce((n, item) =>
    [...candidate.track_genres].some((g) => item.track_genres.has(g)) ? n + 1 : n
  , 0);
}

/**
 * Maximal Marginal Relevance reranking with configurable artist cap and
 * soft genre-repeat penalty.
 *
 * MMR score(i) = λ × relevance(i) − (1−λ) × max_sim_to_selected − genre_penalty × repeated_genres
 */
function rerankForDiversity(rankedCandidates, context) {
  const selected      = [];
  const artistCounts  = new Map();
  const remaining     = [...rankedCandidates];
  const {
    mmr_lambda: lambda,
    max_per_artist: configuredArtistLimit,
    genre_repeat_penalty: genrePenalty,
  } = context.config.diversity;
  const maxPerArtist = Math.max(1, Number(configuredArtistLimit) || 1);

  while (selected.length < context.limit && remaining.length > 0) {
    let bestIndex = -1;
    let best      = null;

    for (let i = 0; i < remaining.length; i++) {
      const c      = remaining[i];
      const artist = normalizeName(c.track.artist_name);

      if ((artistCounts.get(artist) || 0) >= maxPerArtist) continue;

      const maxSimToSelected = selected.length === 0
        ? 0
        : Math.max(0, ...selected.map((s) => cosineSimilarity(c.vector, s.vector)));

      const repeatedGenres   = sharedGenreCount(c, selected);
      const diversityPenalty = (1 - lambda) * maxSimToSelected + genrePenalty * repeatedGenres;
      const mmrScore         = lambda * c.relevance_score - diversityPenalty;

      const isBetter = !best
        || mmrScore > best.mmr_score
        || (mmrScore === best.mmr_score && c.relevance_score > best.relevance_score)
        || (mmrScore === best.mmr_score && c.relevance_score === best.relevance_score
          && String(c.track.track_id).localeCompare(String(best.track.track_id)) < 0);

      if (isBetter) {
        bestIndex = i;
        best = {
          ...c,
          mmr_score:                    mmrScore,
          max_similarity_to_selected:   maxSimToSelected,
          repeated_genres:              repeatedGenres,
          diversity_penalty:            diversityPenalty,
        };
      }
    }

    if (bestIndex === -1) break;
    remaining.splice(bestIndex, 1);
    selected.push(best);
    const artist = normalizeName(best.track.artist_name);
    artistCounts.set(artist, (artistCounts.get(artist) || 0) + 1);
  }

  return selected;
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature alignment (for explanation)
// ─────────────────────────────────────────────────────────────────────────────

function buildFeatureAlignments(userRawVector, candidateRawVector, scalingParams, topN = 3) {
  return FEATURES.map((f, i) => {
    const std = scalingParams[f].std;
    const delta = candidateRawVector[i] - userRawVector[i];
    const stdDelta = delta / std;
    return {
      feature:                     f,
      user_value:                  round(userRawVector[i],        3),
      track_value:                 round(candidateRawVector[i],   3),
      raw_delta:                   round(delta,                   3),
      standardized_delta:          round(stdDelta,                3),
      absolute_standardized_delta: round(Math.abs(stdDelta),      3),
    };
  })
    .sort((a, b) => a.absolute_standardized_delta - b.absolute_standardized_delta)
    .slice(0, topN);
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 4 — Explanation generation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a structured explanation from the actual ranking signals.
 *
 * The narrative is constructed only from signals that crossed the configured
 * mention thresholds — no claim is made that a signal contributed unless its
 * value actually exceeded the threshold.
 */
function buildExplanation(candidate, context) {
  const explainCfg = context.config.explanation || DEFAULT_RECOMMENDATION_CONFIG.explanation;
  const topN       = explainCfg.top_feature_alignments || 3;

  const featureAlignments = buildFeatureAlignments(
    context.userRawVector,
    candidate.rawVector,
    context.preprocessing.params,
    topN,
  );

  const s = candidate.signals;

  // Genre contribution — only reported if above threshold
  const matchedGenres = [...candidate.track_genres].filter(
    (g) => (Number((context.dominantGenres || {})[g]) || 0) / 100 >= explainCfg.genre_mention_threshold
  );
  const genreContribution = {
    matched_genres: matchedGenres,
    score:          round(s.genre_affinity),
    above_threshold: s.genre_affinity >= explainCfg.genre_mention_threshold,
  };

  // Artist contribution — binary, only reported if score ≥ threshold (i.e. = 1.0)
  const artistContribution = {
    is_preferred_artist: s.artist_affinity >= explainCfg.artist_mention_threshold,
    score: round(s.artist_affinity),
  };

  // Novelty contribution — reported when novelty is high
  const noveltyContribution = {
    method:          context.config.novelty.method,
    score:           round(s.novelty),
    is_novel:        s.novelty >= explainCfg.novelty_mention_threshold,
  };

  // Diversity reranking — personalized mode only
  const diversityReranking = context.isPersonalized && candidate.mmr_score !== undefined
    ? {
        mmr_score:                         round(candidate.mmr_score),
        max_similarity_to_previously_selected: round(candidate.max_similarity_to_selected),
        genre_repeat_count:                candidate.repeated_genres,
        diversity_penalty:                 round(candidate.diversity_penalty),
      }
    : null;

  // Full score decomposition
  const rankingSignals = {
    audio_similarity:          round(s.audio_similarity),
    representation_similarity: round(s.representation_similarity),
    audio_score:               round(s.audio_score),
    repr_score:                round(s.repr_score),
    genre_affinity:            round(s.genre_affinity),
    artist_affinity:           round(s.artist_affinity),
    popularity_prior:          round(s.popularity_prior),
    novelty:                   round(s.novelty),
    relevance_score:           round(candidate.relevance_score),
  };

  // ── Narrative construction from actual signal values ───────────────────
  const parts = [];

  // Always lead with the strongest audio-feature alignment
  if (featureAlignments.length > 0) {
    const top = featureAlignments[0];
    const direction = top.raw_delta > 0
      ? `slightly higher ${top.feature}`
      : top.raw_delta < 0
        ? `slightly lower ${top.feature}`
        : `similar ${top.feature}`;
    parts.push(`Closely matches your profile on ${top.feature} (${direction})`);
  }

  if (genreContribution.above_threshold && matchedGenres.length > 0) {
    const genreStr = matchedGenres.slice(0, 2).join(' and ');
    parts.push(`Aligns with your ${genreStr} preference`);
  }

  if (artistContribution.is_preferred_artist) {
    parts.push(`From an artist in your listening history`);
  }

  if (noveltyContribution.is_novel) {
    parts.push(`Less mainstream track — surfaces a less obvious discovery`);
  }

  if (context.isPersonalized && diversityReranking) {
    if (diversityReranking.genre_repeat_count === 0) {
      parts.push(`Adds genre variety to your recommendation list`);
    }
  }

  const narrative = parts.length > 0
    ? parts.join('. ') + '.'
    : context.isPersonalized
      ? 'Ranked by audio-feature similarity with diversity-aware reranking.'
      : 'Ranked by canonical audio-feature cosine similarity.';

  return {
    // Backward-compatible keys (consumed by existing frontend)
    strongest_feature_alignments: featureAlignments,
    feature_deltas:               featureAlignments,
    genre_contribution:           genreContribution,
    novelty_contribution:         noveltyContribution,
    diversity_reranking:          diversityReranking,
    ranking_signals:              rankingSignals,
    // New Phase 6 field
    narrative,
    representation_mode: context.representationMode,
    profile_fallback:    context.profileFallback,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 5 — Build API response items
// ─────────────────────────────────────────────────────────────────────────────

function buildRecommendations(selectedCandidates, context) {
  return selectedCandidates.map((c, i) => ({
    rank:             i + 1,
    track_id:         c.track.track_id,
    track_name:       c.track.track_name,
    artist_name:      c.track.artist_name,
    genre_name:       c.track.genre_name || null,
    track_popularity: c.track.track_popularity,
    // Clearly labelled: raw cosine similarity, not a probability.
    similarity_score: round(c.raw_similarity),
    relevance_score:  round(c.relevance_score),
    audio_features:   Object.fromEntries(FEATURES.map((f) => [f, c.track[f]])),
    explanation:      buildExplanation(c, context),
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Catalog loader (two-tier: materialized view → base tables)
// ─────────────────────────────────────────────────────────────────────────────

async function loadCandidates(sql, genre, minPopularity) {
  try {
    return genre
      ? await sql`
          SELECT track_id, track_name, artist_name, genre_name, track_popularity,
                 danceability, energy, loudness, speechiness, acousticness,
                 instrumentalness, liveness, valence, tempo
          FROM track_feature_vectors
          WHERE track_popularity >= ${minPopularity}
            AND genre_name ILIKE ${'%' + genre + '%'}
          ORDER BY track_popularity DESC
        `
      : await sql`
          SELECT track_id, track_name, artist_name, genre_name, track_popularity,
                 danceability, energy, loudness, speechiness, acousticness,
                 instrumentalness, liveness, valence, tempo
          FROM track_feature_vectors
          WHERE track_popularity >= ${minPopularity}
          ORDER BY track_popularity DESC
        `;
  } catch {
    // Fallback to base tables when the materialized view is unavailable
    return genre
      ? await sql`
          SELECT t.track_id, t.track_name, a.artist_name,
                 STRING_AGG(DISTINCT g.genre_name, ', ') AS genre_name,
                 t.track_popularity,
                 af.danceability, af.energy, af.loudness, af.speechiness,
                 af.acousticness, af.instrumentalness, af.liveness, af.valence, af.tempo
          FROM tracks t
          JOIN artists a ON a.artist_id = t.artist_id
          JOIN audio_features af ON af.track_id = t.track_id
          LEFT JOIN playlist_tracks pt ON pt.track_id = t.track_id
          LEFT JOIN genres g ON g.genre_id = pt.genre_id
          WHERE t.track_popularity >= ${minPopularity}
          GROUP BY t.track_id, t.track_name, a.artist_name, t.track_popularity,
                   af.danceability, af.energy, af.loudness, af.speechiness,
                   af.acousticness, af.instrumentalness, af.liveness, af.valence, af.tempo
          HAVING STRING_AGG(DISTINCT g.genre_name, ', ') ILIKE ${'%' + genre + '%'}
        `
      : await sql`
          SELECT t.track_id, t.track_name, a.artist_name,
                 STRING_AGG(DISTINCT g.genre_name, ', ') AS genre_name,
                 t.track_popularity,
                 af.danceability, af.energy, af.loudness, af.speechiness,
                 af.acousticness, af.instrumentalness, af.liveness, af.valence, af.tempo
          FROM tracks t
          JOIN artists a ON a.artist_id = t.artist_id
          JOIN audio_features af ON af.track_id = t.track_id
          LEFT JOIN playlist_tracks pt ON pt.track_id = t.track_id
          LEFT JOIN genres g ON g.genre_id = pt.genre_id
          WHERE t.track_popularity >= ${minPopularity}
          GROUP BY t.track_id, t.track_name, a.artist_name, t.track_popularity,
                   af.danceability, af.energy, af.loudness, af.speechiness,
                   af.acousticness, af.instrumentalness, af.liveness, af.valence, af.tempo
        `;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// History filter — single batched query
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the set of track IDs to exclude from recommendations in a single
 * batched query.
 *
 * Includes (per config):
 *   - user_liked_tracks (in-app manual likes, always included when enabled)
 *   - user_tracks with match_status IN ('matched','ambiguous') and
 *     match_confidence >= min_confidence_to_exclude (Spotify-derived history)
 *
 * A single UNION ALL query is used to avoid two round-trips.
 *
 * @returns {Promise<Set<string>>}
 */
async function buildHistoryFilter(sql, userId, config) {
  const histCfg      = config.history_filtering || DEFAULT_RECOMMENDATION_CONFIG.history_filtering;
  const historyLimit = Number(histCfg.history_limit) || 2000;
  const minConf      = Number(histCfg.min_confidence_to_exclude) ?? 0.85;
  const includeLiked   = histCfg.exclude_liked_tracks   !== false;
  const includeMatched = histCfg.exclude_matched_tracks !== false;

  if (!includeLiked && !includeMatched) return new Set();

  try {
    const excluded = new Set();

    // Liked tracks
    if (includeLiked) {
      const liked = await sql`
        SELECT catalog_track_id AS track_id
        FROM user_liked_tracks
        WHERE user_id = ${userId}
          AND catalog_track_id IS NOT NULL
        LIMIT ${historyLimit}
      `;
      for (const r of liked) excluded.add(r.track_id);
    }

    // Spotify-matched user_tracks — only if we haven't already hit the limit
    if (includeMatched && excluded.size < historyLimit) {
      const matched = await sql`
        SELECT catalog_track_id AS track_id
        FROM user_tracks
        WHERE user_id = ${userId}
          AND catalog_track_id IS NOT NULL
          AND match_status IN ('matched', 'ambiguous')
          AND (match_confidence IS NULL OR match_confidence >= ${minConf})
        LIMIT ${historyLimit}
      `;
      for (const r of matched) excluded.add(r.track_id);
    }

    return excluded;
  } catch (err) {
    console.warn('[recommender] buildHistoryFilter failed, filtering disabled:', err.message);
    return new Set();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline orchestrator (in-memory, no I/O)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Execute the full recommendation pipeline on an already-loaded catalog.
 * No DB calls inside this function — all I/O is done by the caller.
 *
 * @param {Array}    catalog        — track rows from track_feature_vectors
 * @param {number[]} userRawVector  — 9-element audio feature vector
 * @param {object}   options
 * @param {string}   options.mode                — 'personalized_recommender' | 'baseline_content_recommender'
 * @param {string}   options.representationMode  — 'enhanced' | 'baseline'
 * @param {string}   options.profileFallback     — which fallback was used
 * @param {number}   options.limit
 * @param {object}   options.dominantGenres
 * @param {Array}    options.topArtists
 * @param {Set}      options.excludeTrackIds
 * @param {Array}    options.excludeArtists
 * @param {boolean}  options.excludeSeedArtists
 */
function runRecommendationPipeline(catalog, userRawVector, options) {
  const preprocessing = loadCanonicalPreprocessing();
  if (!preprocessing) {
    throw new Error(
      'Canonical preprocessing artifact unavailable. Deploy ml/artifacts/preprocessing.json.'
    );
  }

  const config  = loadRecommendationConfig();
  const limit   = Math.min(Math.max(Number.parseInt(options.limit, 10) || 20, 1), 50);
  const mode    = options.mode === 'baseline_content_recommender'
    ? 'baseline_content_recommender'
    : 'personalized_recommender';
  const isPersonalized = mode === 'personalized_recommender';
  const representationMode = options.representationMode || 'baseline';

  const seedArtists = options.excludeSeedArtists
    ? (parseJsonValue(options.topArtists) || []).map((a) => a.artist || a.artist_name)
    : [];

  // Pre-compute the standardized user audio vector for audio_score in enhanced mode
  const userStdVector = standardize(userRawVector, preprocessing.params);
  const userVector    = representationMode === 'enhanced'
    ? projectPca(userStdVector, preprocessing.pcaComponents)
    : userStdVector;

  const context = {
    config,
    preprocessing,
    mode,
    isPersonalized,
    representationMode,
    profileFallback: options.profileFallback || 'unknown',
    limit,
    userRawVector,
    userVector,                    // retrieval space (PCA or std)
    userAudioVector: userStdVector, // always standardized audio, for audio_score
    dominantGenres:  parseJsonValue(options.dominantGenres) || {},
    topArtists:      options.topArtists,
    excludeTrackIds: options.excludeTrackIds instanceof Set
      ? options.excludeTrackIds
      : new Set(options.excludeTrackIds || []),
    excludeArtistNames: new Set(
      [...(options.excludeArtists || []), ...seedArtists].map(normalizeName)
    ),
  };

  const retrieved  = retrieveCandidates(catalog, context);
  const ranked     = isPersonalized
    ? rankCandidates(retrieved, context)
    : rankBaselineCandidates(retrieved);
  const reranked   = isPersonalized
    ? rerankForDiversity(ranked, context)
    : ranked.slice(0, limit);

  return {
    recommendations: buildRecommendations(reranked, context),
    recommender_mode: mode,
    representation_mode: representationMode,
    profile_fallback: context.profileFallback,
    stats: {
      total_candidates:     catalog.length,
      retrieved_candidates: retrieved.length,
      ranked_candidates:    ranked.length,
      returned:             reranked.length,
      excluded_history:     context.excludeTrackIds.size,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API — primary entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate personalized recommendations for a user.
 *
 * DB queries (exactly 4 total, none inside the pipeline):
 *   1. SELECT user_profile_data — profile + taste_representation
 *   2. SELECT user_liked_tracks JOIN audio_features — for liked-track-average fallback
 *   3. UNION history filter (liked + matched user_tracks) — buildHistoryFilter()
 *   4. SELECT track_feature_vectors / base tables — catalog load
 *
 * Cold-start: if no personalized vector is available, falls through to
 *   catalog popularity (clearly labelled, non-personalized).
 */
async function generateRecommendations(userId, opts = {}) {
  const limit         = Math.min(Math.max(Number.parseInt(opts.limit, 10) || 20, 1), 50);
  const genre         = opts.genre || null;
  const minPopularity = Math.min(Math.max(Number.parseInt(opts.minPopularity, 10) || 0, 0), 100);
  const requestedMode = opts.mode === 'baseline_content_recommender'
    ? 'baseline_content_recommender'
    : 'personalized_recommender';

  const sql    = getDb();
  const config = loadRecommendationConfig();

  // ── DB query 1: user profile ────────────────────────────────────────────
  const profileRows = await sql`
    SELECT preference_vector, taste_representation, dominant_genres, top_artists
    FROM user_profile_data
    WHERE user_id = ${userId}
    LIMIT 1
  `.catch(() => []);

  // ── DB query 2: liked-track audio features (for liked-average fallback) ─
  const likedRows = await sql`
    SELECT af.danceability, af.energy, af.loudness, af.speechiness,
           af.acousticness, af.instrumentalness, af.liveness, af.valence, af.tempo
    FROM user_liked_tracks ult
    JOIN audio_features af ON af.track_id = ult.catalog_track_id
    WHERE ult.user_id = ${userId}
    LIMIT 100
  `.catch(() => []);

  const profile = profileRows[0] || null;

  // Resolve user vector using explicit fallback chain
  const { vector: userRawVector, fallback: profileFallback, representationMode } =
    resolveUserVector(profile, likedRows, requestedMode, config);

  // ── Cold-start: catalog popularity fallback ─────────────────────────────
  if (!userRawVector) {
    const coldStartLimit = config.cold_start.popularity_fallback_limit || 20;
    const coldStartMinPop = config.cold_start.popularity_fallback_min_popularity || 60;
    const coldRows = await sql`
      SELECT track_id, track_name, artist_name, genre_name, track_popularity,
             danceability, energy, loudness, speechiness, acousticness,
             instrumentalness, liveness, valence, tempo
      FROM track_feature_vectors
      WHERE track_popularity >= ${coldStartMinPop}
      ORDER BY track_popularity DESC
      LIMIT ${coldStartLimit}
    `.catch(() => []);

    return {
      recommendations: coldRows.map((t, i) => ({
        rank:             i + 1,
        track_id:         t.track_id,
        track_name:       t.track_name,
        artist_name:      t.artist_name,
        genre_name:       t.genre_name || null,
        track_popularity: t.track_popularity,
        similarity_score: 0,
        relevance_score:  round(
          Math.log1p(Number(t.track_popularity || 0)) / Math.log(101), 4
        ),
        audio_features:   Object.fromEntries(FEATURES.map((f) => [f, t[f]])),
        explanation: {
          strongest_feature_alignments: [],
          feature_deltas:               [],
          genre_contribution:           { matched_genres: [], score: 0, above_threshold: false },
          novelty_contribution:         { method: 'catalog_popularity', score: 0, is_novel: false },
          diversity_reranking:          null,
          ranking_signals:              { popularity_prior: 1, novelty: 0 },
          narrative:                    'Non-personalized: connect Spotify and run your music analysis to enable personalized recommendations.',
          representation_mode:          'cold_start',
          profile_fallback:             'catalog_popularity',
        },
      })),
      recommender_mode:    'cold_start',
      representation_mode: 'cold_start',
      profile_fallback:    'catalog_popularity',
      stats: { total_candidates: coldRows.length, retrieved_candidates: coldRows.length, ranked_candidates: coldRows.length, returned: coldRows.length, excluded_history: 0 },
      noProfileReason: 'Connect Spotify and run your music analysis first, or like some catalog tracks.',
    };
  }

  // ── DB query 3: history filter ──────────────────────────────────────────
  const excludeTrackIds = await buildHistoryFilter(sql, userId, config);

  // Merge with any caller-supplied exclusions
  for (const id of (opts.excludeTrackIds || [])) excludeTrackIds.add(id);

  // ── DB query 4: catalog ─────────────────────────────────────────────────
  const catalog = await loadCandidates(sql, genre, minPopularity);

  // ── Run pipeline ────────────────────────────────────────────────────────
  const actualMode = requestedMode === 'personalized_recommender'
    ? 'personalized_recommender'
    : 'baseline_content_recommender';

  const result = runRecommendationPipeline(catalog, userRawVector, {
    limit,
    mode: actualMode,
    representationMode,
    profileFallback,
    dominantGenres:      profile?.dominant_genres,
    topArtists:          profile?.top_artists,
    excludeTrackIds,
    excludeArtists:      opts.excludeArtists,
    excludeSeedArtists:  opts.excludeSeedArtists,
  });

  // Attach taste profile metadata for transparency
  const tasteRaw = parseJsonValue(profile?.taste_representation);
  return {
    ...result,
    taste_profile_metadata: tasteRaw?.metadata || null,
    profile_quality:        tasteRaw?.quality  || null,
  };
}

/**
 * Generate recommendations directly from a supplied vector.
 * Used by the Friend Blend engine and the Phase 3 evaluation adapters.
 * History filtering is skipped (caller responsibility).
 */
async function generateRecommendationsFromVector(userRawVector, opts = {}) {
  const sql    = getDb();
  const catalog = await loadCandidates(
    sql,
    opts.genre || null,
    Math.min(Math.max(Number.parseInt(opts.minPopularity, 10) || 0, 0), 100)
  );
  return runRecommendationPipeline(catalog, userRawVector, {
    limit:               opts.limit,
    mode:                'baseline_content_recommender',
    representationMode:  'baseline',
    profileFallback:     'external_vector',
    dominantGenres:      opts.userGenres,
    topArtists:          opts.topArtists,
    excludeTrackIds:     new Set(opts.excludeTrackIds || []),
    excludeArtists:      opts.excludeArtists,
    excludeSeedArtists:  opts.excludeSeedArtists,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports (backward-compatible surface)
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  // Primary entry points
  generateRecommendations,
  generateRecommendationsFromVector,

  // Pipeline stages (used by evaluation adapters and tests)
  retrieveCandidates,
  rankCandidates,
  rankBaselineCandidates,
  rerankForDiversity,
  buildRecommendations,

  // Artifact loaders
  loadCanonicalPreprocessing,
  loadRecommendationConfig,

  // Scoring helpers (used by evaluation adapters)
  smoothGenreAffinity,
  popularitySignals,
  resolveUserVector,
  buildHistoryFilter,

  // Math utilities
  cosineSimilarity,
  standardize,
  FEATURES,

  // Deprecated compat shim
  computeScalingParams,
};

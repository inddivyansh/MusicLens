/**
 * server/lib/tasteProfile.js
 * Source-aware, temporally-decayed user taste aggregation.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SOURCE MODEL
 * ─────────────────────────────────────────────────────────────────────────────
 * Spotify top_tracks arrives with a time_range field (short_term / medium_term /
 * long_term). Phase 5 treats these as SEPARATE source groups rather than
 * collapsing all top_tracks into one bucket. Each group has an independent
 * configurable weight.
 *
 *   source field   →  internal group
 *   ─────────────────────────────────
 *   top_tracks + time_range: short_term   → 'short_term'
 *   top_tracks + time_range: medium_term  → 'medium_term'
 *   top_tracks (any / long_term)          → 'long_term'
 *   recently_played                       → 'recent'
 *   liked_songs                           → 'liked'
 *   manual                                → 'manual'
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AGGREGATION FORMULA (per source group g)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  For each track i in group g:
 *    temporal_weight(i) = exp(-λ_g * age_days(i))   if timestamp available
 *                       = 1.0                         otherwise
 *
 *    frequency_weight(i) = min(interaction_count(i), frequency_cap)
 *    match_weight(i)     = confidence(i)             [0.0–1.0, default 1.0]
 *
 *    w(i) = temporal_weight(i) * frequency_weight(i) * match_weight(i)
 *
 *  Group profile vector:
 *    profile_g = Σ w(i) * feature_vector(i)  /  Σ w(i)
 *    (weighted mean; each feature computed independently so one bad feature
 *     cannot contaminate others)
 *
 *  Final profile vector:
 *    profile = Σ source_weight_g * profile_g  /  Σ source_weight_g
 *    (only groups with ≥1 valid track contribute)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TEMPORAL DECAY
 * ─────────────────────────────────────────────────────────────────────────────
 *  'recent' (recently_played):  λ = config.temporal_decay_lambda_per_day  (default 0.08)
 *    → half-life ≈ 8.7 days. Aggressive: last week strongly outweighs last month.
 *  'liked'  (liked_songs):      λ = config.liked_decay_lambda_per_day      (default 0.005)
 *    → half-life ≈ 139 days. Mild: tracks saved years ago still count; very
 *      recent saves are weighted marginally higher.
 *  'manual':                    no decay (in-app likes have no ordering signal).
 *  'short_term'/'medium_term'/'long_term': no decay (already time-bucketed by Spotify).
 *  Missing timestamp:           weight = 1.0 (never discarded).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CROSS-SOURCE DEDUPLICATION
 * ─────────────────────────────────────────────────────────────────────────────
 *  A catalog track that appears in multiple source groups is assigned to exactly
 *  one group using source_precedence order. This prevents a track from gaining
 *  extra weight just because it surfaces in multiple Spotify endpoints.
 *  Precedence (highest first): manual → liked → recent → short_term → medium_term → long_term
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FEATURE VALIDITY GUARD
 * ─────────────────────────────────────────────────────────────────────────────
 *  Per-feature: if a value is non-finite or outside known physical bounds, that
 *  single value is excluded from that feature's weighted mean rather than
 *  contaminating the entire track or vector.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CONFIDENCE / PROFILE STATUS
 * ─────────────────────────────────────────────────────────────────────────────
 *  Based on the count of catalog-matched tracks feeding into the aggregation
 *  (matched + ambiguous, after deduplication):
 *    < confidence_thresholds.insufficient  → status: 'insufficient_data'
 *    < confidence_thresholds.limited       → status: 'limited'
 *    < confidence_thresholds.established   → status: 'developing'
 *    ≥ confidence_thresholds.established   → status: 'established'
 *
 *  This is a sample-size label, not a recommendation-quality claim.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FALLBACK
 * ─────────────────────────────────────────────────────────────────────────────
 *  If no group produces a valid weighted mean (all tracks have non-finite
 *  features, or no tracks with catalog matches exist), buildTasteRepresentation
 *  returns null. Callers must check for null and fall back to the baseline
 *  preference_vector from profileCalculator.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { RECOMMENDATION_FEATURES } = require('./profileCalculator');

// ─────────────────────────────────────────────────────────────────────────────
// Physical bounds for Spotify audio features (from Spotify API spec).
// A value outside these bounds is treated as corrupt for that feature only.
// ─────────────────────────────────────────────────────────────────────────────
const FEATURE_BOUNDS = {
  danceability:     [0.0, 1.0],
  energy:           [0.0, 1.0],
  loudness:         [-60.0, 5.0],
  speechiness:      [0.0, 1.0],
  acousticness:     [0.0, 1.0],
  instrumentalness: [0.0, 1.0],
  liveness:         [0.0, 1.0],
  valence:          [0.0, 1.0],
  tempo:            [30.0, 300.0],
};

// ─────────────────────────────────────────────────────────────────────────────
// Source → internal group mapping
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve a (source, time_range) pair to an internal aggregation group.
 * time_range is only meaningful for top_tracks — ignored for all other sources.
 *
 * @param {string} source       — 'top_tracks' | 'recently_played' | 'liked_songs' | 'manual'
 * @param {string} [time_range] — 'short_term' | 'medium_term' | 'long_term'
 * @returns {string}            — internal group key
 */
function resolveGroup(source, time_range) {
  if (source === 'top_tracks') {
    if (time_range === 'short_term')  return 'short_term';
    if (time_range === 'medium_term') return 'medium_term';
    return 'long_term'; // long_term or unspecified
  }
  if (source === 'recently_played') return 'recent';
  if (source === 'liked_songs')     return 'liked';
  if (source === 'manual')          return 'manual';
  return 'long_term'; // safe fallback for unknown sources
}

// ─────────────────────────────────────────────────────────────────────────────
// Config loading
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_AGGREGATION = Object.freeze({
  source_weights: {
    long_term:   1.0,
    medium_term: 0.8,
    short_term:  0.6,
    recent:      1.0,
    liked:       1.2,
    manual:      1.2,
  },
  temporal_decay_lambda_per_day: 0.08,
  liked_decay_lambda_per_day:    0.005,
  frequency_cap: 10,
  source_precedence: ['manual', 'liked', 'recent', 'short_term', 'medium_term', 'long_term'],
  decay_sources: ['recent', 'liked'],
  confidence_thresholds: {
    insufficient: 3,
    limited:      15,
    established:  40,
  },
});

let _cachedConfig = null;
let _configMtime  = null;

/**
 * Load aggregation config from ml/artifacts/model_config.json.
 * Caches the result; re-reads if the file has been modified since last load.
 * Falls back to DEFAULT_AGGREGATION on any error.
 */
function loadAggregationConfig() {
  const artifactPath = path.join(
    __dirname, '..', '..', 'ml', 'artifacts', 'model_config.json'
  );
  try {
    const stat = fs.statSync(artifactPath);
    const mtime = stat.mtimeMs;
    if (_cachedConfig && _configMtime === mtime) return _cachedConfig;

    const stored = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
    const cfg = stored?.aggregation;
    if (!cfg || typeof cfg !== 'object') {
      _cachedConfig = DEFAULT_AGGREGATION;
      _configMtime  = mtime;
      return _cachedConfig;
    }

    _cachedConfig = {
      source_weights: {
        ...DEFAULT_AGGREGATION.source_weights,
        ...(cfg.source_weights || {}),
      },
      temporal_decay_lambda_per_day:
        Number.isFinite(cfg.temporal_decay_lambda_per_day)
          ? cfg.temporal_decay_lambda_per_day
          : DEFAULT_AGGREGATION.temporal_decay_lambda_per_day,
      liked_decay_lambda_per_day:
        Number.isFinite(cfg.liked_decay_lambda_per_day)
          ? cfg.liked_decay_lambda_per_day
          : DEFAULT_AGGREGATION.liked_decay_lambda_per_day,
      frequency_cap:
        Number.isFinite(cfg.frequency_cap) && cfg.frequency_cap > 0
          ? cfg.frequency_cap
          : DEFAULT_AGGREGATION.frequency_cap,
      source_precedence: Array.isArray(cfg.source_precedence)
        ? cfg.source_precedence
        : DEFAULT_AGGREGATION.source_precedence,
      decay_sources: Array.isArray(cfg.decay_sources)
        ? cfg.decay_sources
        : DEFAULT_AGGREGATION.decay_sources,
      confidence_thresholds: {
        ...DEFAULT_AGGREGATION.confidence_thresholds,
        ...(cfg.confidence_thresholds || {}),
      },
    };
    _configMtime = mtime;
    return _cachedConfig;
  } catch {
    return DEFAULT_AGGREGATION;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function parseTimestamp(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Validate a single feature value against known physical bounds.
 * Returns the value if valid, null if corrupt/out-of-bounds.
 */
function validFeatureValue(feature, value) {
  const v = Number(value);
  if (!Number.isFinite(v)) return null;
  const bounds = FEATURE_BOUNDS[feature];
  if (bounds && (v < bounds[0] || v > bounds[1])) return null;
  return v;
}

/**
 * Extract a per-feature validity-checked array from a track object.
 * Returns an array of [value|null] — one entry per RECOMMENDATION_FEATURES slot.
 * null means "this feature is missing/corrupt for this track"; it is excluded
 * from the weighted mean for that feature only.
 */
function extractValidFeatures(track) {
  return RECOMMENDATION_FEATURES.map((feature) =>
    validFeatureValue(feature, track[feature])
  );
}

/**
 * Compute the temporal decay weight for a track.
 *
 * @param {string}  group   — internal group key
 * @param {Date|null} ts    — event timestamp (played_at or added_at)
 * @param {Date}    now
 * @param {object}  config
 * @returns {number} weight in (0, 1] — never 0 (timestamps are never penalised to zero)
 */
function temporalWeight(group, ts, now, config) {
  if (!config.decay_sources.includes(group) || !ts) return 1.0;
  const ageDays = Math.max(0, (now.getTime() - ts.getTime()) / 86_400_000);
  const lambda = group === 'liked'
    ? config.liked_decay_lambda_per_day
    : config.temporal_decay_lambda_per_day;
  // exp(-lambda * age) is always in (0, 1]; never zero for finite ages.
  return Math.exp(-lambda * ageDays);
}

/**
 * Build cross-source deduplication map: catalog_track_id → winning group.
 * Tracks without a catalog_track_id are NOT deduplicated (each source slot is
 * independent at the matching layer; dedup only applies to known catalog tracks).
 *
 * @param {Array}  tracks   — items with { catalog_track_id, source, time_range }
 * @param {object} config
 * @returns {Map<string, string>} catalog_track_id → winning group name
 */
function buildDeduplicationMap(tracks, config) {
  const precedence = new Map(
    config.source_precedence.map((g, i) => [g, i])
  );
  const winner = new Map(); // catalog_track_id → { group, priority }

  for (const track of tracks) {
    const id = track.catalog_track_id;
    if (!id) continue;
    const group = resolveGroup(track.source, track.time_range);
    const priority = precedence.get(group) ?? config.source_precedence.length;
    const existing = winner.get(id);
    if (!existing || priority < existing.priority) {
      winner.set(id, { group, priority });
    }
  }

  // Return only the group name per catalog ID
  const result = new Map();
  for (const [id, { group }] of winner) result.set(id, group);
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Confidence / profile status
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Determine profile quality status from the number of catalog-matched tracks.
 *
 * @param {number} matchedCount — unique catalog tracks that fed into aggregation
 * @param {object} thresholds   — from config.confidence_thresholds
 * @returns {{ status: string, matched_track_count: number }}
 */
function profileQuality(matchedCount, thresholds) {
  let status;
  if (matchedCount < thresholds.insufficient) {
    status = 'insufficient_data';
  } else if (matchedCount < thresholds.limited) {
    status = 'limited';
  } else if (matchedCount < thresholds.established) {
    status = 'developing';
  } else {
    status = 'established';
  }
  return { status, matched_track_count: matchedCount };
}

// ─────────────────────────────────────────────────────────────────────────────
// Core aggregation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Aggregate all tracks in a single group into a per-feature weighted mean.
 *
 * Returns { vector: number[], totalWeight: number, featureValidCounts: number[] }
 * where vector[i] is the weighted mean for RECOMMENDATION_FEATURES[i], or null
 * if no valid observations exist for that feature.
 *
 * @param {Array<{
 *   features: (number|null)[],  — extractValidFeatures() output
 *   weight:   number,
 * }>} entries
 * @returns {{ vector: (number|null)[], totalWeight: number }}
 */
function aggregateGroup(entries) {
  const nFeatures = RECOMMENDATION_FEATURES.length;
  // Separate accumulator + weight per feature (feature-level validity guard)
  const numerator   = new Float64Array(nFeatures);
  const denominator = new Float64Array(nFeatures);

  for (const { features, weight } of entries) {
    for (let i = 0; i < nFeatures; i++) {
      const v = features[i];
      if (v !== null) {
        numerator[i]   += v * weight;
        denominator[i] += weight;
      }
    }
  }

  const vector = RECOMMENDATION_FEATURES.map((_, i) =>
    denominator[i] > 0 ? numerator[i] / denominator[i] : null
  );

  const totalWeight = entries.reduce((s, e) => s + e.weight, 0);
  return { vector, totalWeight };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a production-quality, source-aware taste representation from
 * a user's resolved Spotify tracks + in-app manual likes.
 *
 * @param {Array<{
 *   catalog_track_id?: string,
 *   source:            string,
 *   time_range?:       string,
 *   played_at?:        string|null,
 *   added_at?:         string|null,
 *   interaction_count?: number,
 *   confidence?:       number,    — match confidence from trackMatcher (0.0–1.0)
 *   danceability?:     number,
 *   energy?:           number,
 *   loudness?:         number,
 *   speechiness?:      number,
 *   acousticness?:     number,
 *   instrumentalness?: number,
 *   liveness?:         number,
 *   valence?:          number,
 *   tempo?:            number,
 * }>} tracks
 *
 * @param {Date}   [now]     — reference time (injectable for deterministic tests)
 * @param {object} [config]  — override loaded config (injectable for tests)
 *
 * @returns {{
 *   raw_vector:      number[],
 *   source_profiles: object,
 *   metadata:        object,
 *   quality:         object,
 * } | null}  null if no groups produced a valid vector
 */
function buildTasteRepresentation(tracks, now = new Date(), config = loadAggregationConfig()) {
  if (!tracks || tracks.length === 0) return null;

  // ── 1. Cross-source deduplication ───────────────────────────────────────
  // Maps each catalog_track_id to its winning group. Tracks without a
  // catalog ID are not deduplicated — they each occupy their own slot.
  const dedupeWinner = buildDeduplicationMap(tracks, config);

  // ── 2. Assign each track to a group, compute its composite weight ───────
  // Groups hold arrays of { features, weight, temporalWeight, frequencyWeight }
  const ALL_GROUPS = ['short_term', 'medium_term', 'long_term', 'recent', 'liked', 'manual'];
  const grouped = Object.fromEntries(ALL_GROUPS.map((g) => [g, []]));

  // Track which catalog IDs are actually used (for quality / dedup reporting)
  const usedCatalogIds = new Set();

  for (const track of tracks) {
    const catalogId = track.catalog_track_id;
    const group = resolveGroup(track.source, track.time_range);

    // Cross-source dedup: if this catalog track has a winning group and this
    // entry is not from that group, skip it.
    if (catalogId) {
      const winningGroup = dedupeWinner.get(catalogId);
      if (winningGroup && winningGroup !== group) continue;
    }

    const features = extractValidFeatures(track);
    // Skip track entirely if ALL features are null (no usable data)
    if (features.every((v) => v === null)) continue;

    const ts = parseTimestamp(track.played_at || track.added_at);
    const tWeight = temporalWeight(group, ts, now, config);

    const rawFreq = Number.parseInt(track.interaction_count, 10);
    const freq = Number.isFinite(rawFreq) && rawFreq > 0
      ? Math.min(rawFreq, config.frequency_cap)
      : 1;

    // Match confidence weight: exact_id=1.0, ambiguous≈0.75–0.90, unmatched excluded.
    // Falls back to 1.0 if not provided (e.g. manual likes).
    const matchW = Number.isFinite(track.confidence) ? Math.max(0.01, track.confidence) : 1.0;

    const compositeWeight = tWeight * freq * matchW;

    grouped[group].push({
      features,
      weight: compositeWeight,
      temporalWeight: tWeight,
      frequencyWeight: freq,
      matchWeight: matchW,
      catalogId: catalogId || null,
    });

    if (catalogId) usedCatalogIds.add(catalogId);
  }

  // ── 3. Aggregate each group independently ───────────────────────────────
  const sourceProfiles = {};
  const activeProfiles = []; // { vector, sourceWeight } — groups that will contribute

  for (const group of ALL_GROUPS) {
    const entries = grouped[group];
    if (entries.length === 0) continue;

    const sourceWeight = Number(config.source_weights[group]) ?? 0;
    if (sourceWeight <= 0) continue; // Group configured to be excluded

    const { vector, totalWeight } = aggregateGroup(entries);

    // A group only contributes if at least one feature produced a valid mean
    if (vector.every((v) => v === null)) continue;

    // Compute per-group explainability metadata
    const meanTemporalWeight = entries.reduce((s, e) => s + e.temporalWeight, 0) / entries.length;
    const meanFrequency      = entries.reduce((s, e) => s + e.frequencyWeight, 0) / entries.length;
    const meanMatchConfidence = entries.reduce((s, e) => s + e.matchWeight, 0) / entries.length;

    sourceProfiles[group] = {
      raw_vector:           _roundVector(vector),
      unique_tracks:        entries.length,
      unique_catalog_ids:   new Set(entries.map((e) => e.catalogId).filter(Boolean)).size,
      effective_weight:     round(totalWeight),
      source_weight:        sourceWeight,
      mean_temporal_weight: round(meanTemporalWeight),
      mean_frequency:       round(meanFrequency),
      mean_match_confidence: round(meanMatchConfidence),
    };

    activeProfiles.push({ vector, sourceWeight });
  }

  if (activeProfiles.length === 0) return null;

  // ── 4. Combine group profiles into the final profile vector ─────────────
  // Per-feature weighted mean across groups; features still guarded individually.
  const nFeatures = RECOMMENDATION_FEATURES.length;
  const finalNumerator   = new Float64Array(nFeatures);
  const finalDenominator = new Float64Array(nFeatures);

  for (const { vector, sourceWeight } of activeProfiles) {
    for (let i = 0; i < nFeatures; i++) {
      if (vector[i] !== null) {
        finalNumerator[i]   += vector[i] * sourceWeight;
        finalDenominator[i] += sourceWeight;
      }
    }
  }

  // If any feature has no contributing group at all, fall back to the
  // simple mean across the active profiles for that feature only.
  const rawVector = Array.from({ length: nFeatures }, (_, i) => {
    if (finalDenominator[i] > 0) return finalNumerator[i] / finalDenominator[i];
    // Last-resort: plain mean of whatever non-null values exist across groups
    const vals = activeProfiles.map((p) => p.vector[i]).filter((v) => v !== null);
    return vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
  });

  // ── 5. Confidence / quality status ──────────────────────────────────────
  const quality = profileQuality(
    usedCatalogIds.size,
    config.confidence_thresholds
  );

  // ── 6. Assemble metadata ─────────────────────────────────────────────────
  const groupCounts = Object.fromEntries(
    ALL_GROUPS.map((g) => [g, grouped[g].length])
  );

  const metadata = {
    // Backward-compatible keys (consumed by recommender.js and tasteProfile callers)
    unique_tracks: Object.values(groupCounts).reduce((s, c) => s + c, 0),
    unique_catalog_ids: usedCatalogIds.size,
    recent_tracks:   groupCounts.recent   || 0,
    liked_tracks:    (groupCounts.liked   || 0) + (groupCounts.manual || 0),
    long_term_tracks: (groupCounts.long_term || 0) + (groupCounts.medium_term || 0) + (groupCounts.short_term || 0),
    profile_sample_size: usedCatalogIds.size,

    // Phase 5 additions
    source_contributions: {
      short_term:  groupCounts.short_term  || 0,
      medium_term: groupCounts.medium_term || 0,
      long_term:   groupCounts.long_term   || 0,
      recent:      groupCounts.recent      || 0,
      liked:       groupCounts.liked       || 0,
      manual:      groupCounts.manual      || 0,
    },
    active_groups:      Object.keys(sourceProfiles),
    deduplication:      'catalog_track_id deduped across groups via source_precedence; unmatched tracks not deduped',
    aggregation_method: 'per-feature weighted mean within group → source-weighted mean across groups',
    config_snapshot: {
      source_weights:                   config.source_weights,
      temporal_decay_lambda_per_day:    config.temporal_decay_lambda_per_day,
      liked_decay_lambda_per_day:       config.liked_decay_lambda_per_day,
      frequency_cap:                    config.frequency_cap,
      decay_sources:                    config.decay_sources,
      source_precedence:                config.source_precedence,
    },
  };

  return {
    raw_vector:      _roundVector(rawVector),
    source_profiles: sourceProfiles,
    metadata,
    quality,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Private helpers
// ─────────────────────────────────────────────────────────────────────────────

function round(v, digits = 6) {
  const m = 10 ** digits;
  return Math.round(v * m) / m;
}

function _roundVector(vec) {
  return (vec || []).map((v) => (v !== null ? round(v, 10) : null));
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  buildTasteRepresentation,
  loadAggregationConfig,
  resolveGroup,
  profileQuality,
  // Exported for use in tests and the Python-mirroring Python feature layer
  FEATURE_BOUNDS,
  DEFAULT_AGGREGATION,
};

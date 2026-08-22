/**
 * Source-aware user taste aggregation for the Node recommendation path.
 *
 * The persisted ML model configuration is the source of truth for source
 * weights and recency settings. This mirrors ml/features/user_features.py so
 * Spotify ingestion can create a profile without a Python runtime in Vercel.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { RECOMMENDATION_FEATURES } = require('./profileCalculator');

const SOURCE_TO_GROUP = {
  top_tracks: 'long_term',
  recently_played: 'recent',
  liked_songs: 'liked',
  manual: 'liked',
};

const DEFAULT_AGGREGATION = Object.freeze({
  source_weights: { long_term: 1, recent: 1, liked: 1 },
  temporal_decay_lambda_per_day: 0.08,
  frequency_cap: 10,
  source_precedence: ['liked', 'recent', 'long_term'],
  decay_sources: ['recent'],
});

function loadAggregationConfig() {
  const artifactPath = path.join(__dirname, '..', '..', 'ml', 'artifacts', 'model_config.json');
  try {
    const stored = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
    const config = stored?.aggregation;
    if (!config || typeof config !== 'object') return DEFAULT_AGGREGATION;
    return {
      ...DEFAULT_AGGREGATION,
      ...config,
      source_weights: { ...DEFAULT_AGGREGATION.source_weights, ...(config.source_weights || {}) },
    };
  } catch {
    // Existing deployments remain functional before trained artifacts are deployed.
    return DEFAULT_AGGREGATION;
  }
}

function sourceGroup(source) {
  return SOURCE_TO_GROUP[source] || 'long_term';
}

function eventTime(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function validVector(track) {
  const vector = RECOMMENDATION_FEATURES.map((feature) => Number(track[feature]));
  return vector.every(Number.isFinite) ? vector : null;
}

function deduplicateTracks(tracks, config) {
  const priority = new Map(config.source_precedence.map((group, index) => [group, index]));
  const selected = new Map();
  for (const track of tracks || []) {
    const id = track.catalog_track_id || track.track_id;
    if (!id) continue;
    const current = selected.get(id);
    if (!current) {
      selected.set(id, track);
      continue;
    }
    const nextPriority = priority.get(sourceGroup(track.source)) ?? priority.size;
    const currentPriority = priority.get(sourceGroup(current.source)) ?? priority.size;
    if (nextPriority < currentPriority) selected.set(id, track);
  }
  return [...selected.values()];
}

function weightedMean(entries) {
  const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);
  return RECOMMENDATION_FEATURES.map((_, index) => (
    entries.reduce((sum, entry) => sum + entry.vector[index] * entry.weight, 0) / totalWeight
  ));
}

/**
 * Return a transparent raw representation. It intentionally returns no made-up
 * confidence percentage; callers receive actual sample-size/source metadata.
 */
function buildTasteRepresentation(tracks, now = new Date(), config = loadAggregationConfig()) {
  const grouped = { long_term: [], recent: [], liked: [] };
  for (const track of deduplicateTracks(tracks, config)) {
    const vector = validVector(track);
    if (!vector) continue;
    const group = sourceGroup(track.source);
    const timestamp = eventTime(track.played_at || track.added_at || track.event_at);
    let temporalWeight = 1;
    if (config.decay_sources.includes(group) && timestamp) {
      const ageDays = Math.max(0, (now.getTime() - timestamp.getTime()) / 86400000);
      temporalWeight = Math.exp(-Number(config.temporal_decay_lambda_per_day) * ageDays);
    }
    const frequency = Math.min(
      Math.max(Number.parseInt(track.interaction_count, 10) || 1, 1),
      Number(config.frequency_cap) || 1,
    );
    grouped[group].push({ vector, weight: temporalWeight * frequency, temporalWeight });
  }

  const sourceProfiles = {};
  const activeProfiles = [];
  for (const [group, entries] of Object.entries(grouped)) {
    if (entries.length === 0) continue;
    const sourceWeight = Number(config.source_weights[group]) || 0;
    const profile = weightedMean(entries);
    sourceProfiles[group] = {
      raw_vector: profile.map((value) => Math.round(value * 1e10) / 1e10),
      unique_tracks: entries.length,
      effective_track_weight: entries.reduce((sum, entry) => sum + entry.weight, 0),
      source_weight: sourceWeight,
      mean_temporal_weight: entries.reduce((sum, entry) => sum + entry.temporalWeight, 0) / entries.length,
    };
    if (sourceWeight > 0) activeProfiles.push({ profile, sourceWeight });
  }
  if (activeProfiles.length === 0) return null;

  const totalSourceWeight = activeProfiles.reduce((sum, item) => sum + item.sourceWeight, 0);
  const rawVector = RECOMMENDATION_FEATURES.map((_, index) => (
    activeProfiles.reduce((sum, item) => sum + item.profile[index] * item.sourceWeight, 0) / totalSourceWeight
  ));
  const sourceCounts = Object.fromEntries(
    Object.entries(sourceProfiles).map(([group, profile]) => [group, profile.unique_tracks]),
  );
  return {
    raw_vector: rawVector.map((value) => Math.round(value * 1e10) / 1e10),
    source_profiles: sourceProfiles,
    metadata: {
      unique_tracks: Object.values(sourceCounts).reduce((sum, count) => sum + count, 0),
      recent_tracks: sourceCounts.recent || 0,
      liked_tracks: sourceCounts.liked || 0,
      long_term_tracks: sourceCounts.long_term || 0,
      profile_sample_size: Object.values(sourceCounts).reduce((sum, count) => sum + count, 0),
      source_contributions: sourceCounts,
      deduplication: 'one source per track using liked > recent > long_term precedence',
    },
  };
}

module.exports = { buildTasteRepresentation, loadAggregationConfig };


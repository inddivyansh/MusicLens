/**
 * MusicLens recommendation pipeline.
 *
 * baseline_content_recommender:
 *   mean profile -> canonical StandardScaler -> cosine retrieval -> ranking
 * personalized_recommender:
 *   Phase 1 taste profile -> canonical StandardScaler + PCA -> cosine retrieval
 *   -> configurable relevance ranking -> MMR diversity re-ranking.
 *
 * This module is the server-side source of truth for personalized ranking.
 * It never derives scaling statistics from a request, filter, or candidate set.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { getDb } = require('./db');

const FEATURES = [
  'danceability', 'energy', 'loudness', 'speechiness',
  'acousticness', 'instrumentalness', 'liveness', 'valence', 'tempo',
];

const DEFAULT_RECOMMENDATION_CONFIG = Object.freeze({
  retrieval: { candidate_limit: 500 },
  ranking: {
    weights: {
      audio_similarity: 0.8,
      genre_affinity: 0.08,
      artist_affinity: 0.04,
      popularity_prior: 0.02,
      novelty: 0.06,
    },
  },
  diversity: {
    mmr_lambda: 0.75,
    max_per_artist: 2,
    genre_repeat_penalty: 0.04,
    exclude_seed_artists: false,
  },
  novelty: { method: 'inverse_log_catalog_popularity' },
});

function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dot / denominator;
}

/** Compatibility helper that returns only persisted catalog-wide statistics. */
function computeScalingParams() {
  const preprocessing = loadCanonicalPreprocessing();
  if (!preprocessing) throw new Error('Canonical recommendation preprocessing artifact is unavailable.');
  return preprocessing.params;
}

function standardize(rawVector, params) {
  return FEATURES.map((feature, index) => {
    const { mean, std } = params[feature];
    return (rawVector[index] - mean) / std;
  });
}

function parseJsonValue(value) {
  if (!value || typeof value === 'object') return value || null;
  try { return JSON.parse(value); } catch { return null; }
}

function loadCanonicalPreprocessing() {
  const artifactPath = path.join(__dirname, '..', '..', 'ml', 'artifacts', 'preprocessing.json');
  try {
    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
    if (
      !Array.isArray(artifact.feature_columns)
      || artifact.feature_columns.join('|') !== FEATURES.join('|')
      || !Array.isArray(artifact?.scaler?.mean)
      || !Array.isArray(artifact?.scaler?.scale)
      || !Array.isArray(artifact?.pca?.components)
    ) return null;
    const params = Object.fromEntries(FEATURES.map((feature, index) => [feature, {
      mean: Number(artifact.scaler.mean[index]),
      std: Number(artifact.scaler.scale[index]),
    }]));
    if (Object.values(params).some(({ mean, std }) => !Number.isFinite(mean) || !Number.isFinite(std) || std === 0)) return null;
    return { params, pcaComponents: artifact.pca.components };
  } catch {
    return null;
  }
}

function loadRecommendationConfig() {
  const configPath = path.join(__dirname, '..', '..', 'ml', 'recommendation_config.json');
  try {
    const configured = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return {
      ...DEFAULT_RECOMMENDATION_CONFIG,
      ...configured,
      retrieval: { ...DEFAULT_RECOMMENDATION_CONFIG.retrieval, ...(configured.retrieval || {}) },
      ranking: {
        ...DEFAULT_RECOMMENDATION_CONFIG.ranking,
        ...(configured.ranking || {}),
        weights: {
          ...DEFAULT_RECOMMENDATION_CONFIG.ranking.weights,
          ...(configured.ranking?.weights || {}),
        },
      },
      diversity: { ...DEFAULT_RECOMMENDATION_CONFIG.diversity, ...(configured.diversity || {}) },
      novelty: { ...DEFAULT_RECOMMENDATION_CONFIG.novelty, ...(configured.novelty || {}) },
    };
  } catch {
    return DEFAULT_RECOMMENDATION_CONFIG;
  }
}

function projectPca(vector, components) {
  return components.map((component) => component.reduce(
    (sum, coefficient, index) => sum + Number(coefficient) * vector[index], 0,
  ));
}

function rawTrackVector(track) {
  const vector = FEATURES.map((feature) => Number(track[feature]));
  return vector.every(Number.isFinite) ? vector : null;
}

function normalizeName(value) {
  return String(value || '').trim().toLowerCase();
}

function genreSet(value) {
  return new Set(String(value || '').split(',').map((genre) => normalizeName(genre)).filter(Boolean));
}

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value, digits = 4) {
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
}

function profileGenreAffinity(trackGenres, dominantGenres) {
  const normalizedProfile = parseJsonValue(dominantGenres) || {};
  const candidates = [...trackGenres].map((genre) => Number(normalizedProfile[genre]) || 0);
  return clamp(Math.max(0, ...candidates) / 100);
}

function profileArtistAffinity(artistName, topArtists) {
  const artists = parseJsonValue(topArtists) || [];
  const artistSet = new Set(artists.map((artist) => normalizeName(artist.artist || artist.artist_name)));
  return artistSet.has(normalizeName(artistName)) ? 1 : 0;
}

function popularitySignals(popularity) {
  const boundedPopularity = clamp(Number(popularity) / 100);
  const popularityPrior = Math.log1p(boundedPopularity * 100) / Math.log(101);
  return {
    popularityPrior,
    novelty: 1 - popularityPrior,
  };
}

function transformForMode(rawVector, context) {
  const standardized = standardize(rawVector, context.preprocessing.params);
  return context.mode === 'personalized_recommender'
    ? projectPca(standardized, context.preprocessing.pcaComponents)
    : standardized;
}

/**
 * Stage 1: retrieve a bounded set of semantically similar candidates.
 * The only catalog-wide work is one linear scan plus sort; later stages never
 * compare every catalog track with every other catalog track.
 */
function retrieveCandidates(catalog, context) {
  const retrieved = [];
  for (const track of catalog) {
    if (context.excludeTrackIds.has(track.track_id)) continue;
    if (context.excludeArtistNames.has(normalizeName(track.artist_name))) continue;
    const rawVector = rawTrackVector(track);
    if (!rawVector) continue;
    const vector = transformForMode(rawVector, context);
    const rawSimilarity = cosineSimilarity(context.userVector, vector);
    retrieved.push({
      track,
      rawVector,
      vector,
      raw_similarity: rawSimilarity,
      normalized_similarity: clamp((rawSimilarity + 1) / 2),
      track_genres: genreSet(track.genre_name),
    });
  }
  retrieved.sort((left, right) => (
    right.raw_similarity - left.raw_similarity
    || Number(right.track.track_popularity || 0) - Number(left.track.track_popularity || 0)
    || String(left.track.track_id).localeCompare(String(right.track.track_id))
  ));
  return retrieved.slice(0, Math.max(context.limit, Number(context.config.retrieval.candidate_limit) || context.limit));
}

/** Stage 2: combine configured relevance signals without treating cosine as probability. */
function rankCandidates(candidates, context) {
  const weights = context.config.ranking.weights;
  return candidates.map((candidate) => {
    const genreAffinity = profileGenreAffinity(candidate.track_genres, context.dominantGenres);
    const artistAffinity = profileArtistAffinity(candidate.track.artist_name, context.topArtists);
    const { popularityPrior, novelty } = popularitySignals(candidate.track.track_popularity);
    const relevanceScore = (
      weights.audio_similarity * candidate.normalized_similarity
      + weights.genre_affinity * genreAffinity
      + weights.artist_affinity * artistAffinity
      + weights.popularity_prior * popularityPrior
      + weights.novelty * novelty
    );
    return {
      ...candidate,
      relevance_score: relevanceScore,
      signals: {
        audio_similarity: candidate.raw_similarity,
        genre_affinity: genreAffinity,
        artist_affinity: artistAffinity,
        popularity_prior: popularityPrior,
        novelty,
      },
    };
  }).sort((left, right) => (
    right.relevance_score - left.relevance_score
    || right.raw_similarity - left.raw_similarity
    || String(left.track.track_id).localeCompare(String(right.track.track_id))
  ));
}

/** Baseline comparison path: canonical-scaled cosine only, with deterministic ties. */
function rankBaselineCandidates(candidates) {
  return candidates.map((candidate) => ({
    ...candidate,
    relevance_score: candidate.normalized_similarity,
    signals: {
      audio_similarity: candidate.raw_similarity,
      genre_affinity: 0,
      artist_affinity: 0,
      popularity_prior: 0,
      novelty: 0,
    },
  })).sort((left, right) => (
    right.raw_similarity - left.raw_similarity
    || Number(right.track.track_popularity || 0) - Number(left.track.track_popularity || 0)
    || String(left.track.track_id).localeCompare(String(right.track.track_id))
  ));
}

function sharedGenreCount(candidate, selected) {
  return selected.reduce((count, item) => (
    [...candidate.track_genres].some((genre) => item.track_genres.has(genre)) ? count + 1 : count
  ), 0);
}

/**
 * Stage 3: maximal marginal relevance (MMR) over the retrieved set, plus a
 * configurable soft genre-repeat penalty and a hard artist cap.
 */
function rerankForDiversity(rankedCandidates, context) {
  const selected = [];
  const artistCounts = new Map();
  const remaining = [...rankedCandidates];
  const { mmr_lambda: mmrLambda, max_per_artist: configuredArtistLimit, genre_repeat_penalty: genrePenalty } = context.config.diversity;
  const maxPerArtist = Math.max(1, Number(configuredArtistLimit) || 1);

  while (selected.length < context.limit && remaining.length > 0) {
    let bestIndex = -1;
    let best = null;
    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index];
      const artist = normalizeName(candidate.track.artist_name);
      if ((artistCounts.get(artist) || 0) >= maxPerArtist) continue;
      const maxSimilarityToSelected = selected.length === 0
        ? 0
        : Math.max(0, ...selected.map((item) => cosineSimilarity(candidate.vector, item.vector)));
      const repeatedGenres = sharedGenreCount(candidate, selected);
      const diversityPenalty = (1 - mmrLambda) * maxSimilarityToSelected + genrePenalty * repeatedGenres;
      const mmrScore = mmrLambda * candidate.relevance_score - diversityPenalty;
      if (
        !best
        || mmrScore > best.mmr_score
        || (mmrScore === best.mmr_score && candidate.relevance_score > best.relevance_score)
        || (mmrScore === best.mmr_score && candidate.relevance_score === best.relevance_score
          && String(candidate.track.track_id).localeCompare(String(best.track.track_id)) < 0)
      ) {
        bestIndex = index;
        best = { ...candidate, mmr_score: mmrScore, max_similarity_to_selected: maxSimilarityToSelected, repeated_genres: repeatedGenres, diversity_penalty: diversityPenalty };
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

function buildFeatureAlignments(userRawVector, candidateRawVector, scalingParams) {
  return FEATURES.map((feature, index) => {
    const standardizedDelta = (candidateRawVector[index] - userRawVector[index]) / scalingParams[feature].std;
    return {
      feature,
      user_value: round(userRawVector[index], 3),
      track_value: round(candidateRawVector[index], 3),
      raw_delta: round(candidateRawVector[index] - userRawVector[index], 3),
      standardized_delta: round(standardizedDelta, 3),
      absolute_standardized_delta: round(Math.abs(standardizedDelta), 3),
    };
  }).sort((left, right) => left.absolute_standardized_delta - right.absolute_standardized_delta).slice(0, 3);
}

function buildExplanation(candidate, context) {
  const strongestFeatureAlignments = buildFeatureAlignments(
    context.userRawVector,
    candidate.rawVector,
    context.preprocessing.params,
  );
  const matchedGenres = [...candidate.track_genres].filter((genre) => profileGenreAffinity(new Set([genre]), context.dominantGenres) > 0);
  const rankingSignals = {
    audio_similarity: round(candidate.signals.audio_similarity),
    genre_affinity: round(candidate.signals.genre_affinity),
    artist_affinity: round(candidate.signals.artist_affinity),
    popularity_prior: round(candidate.signals.popularity_prior),
    novelty: round(candidate.signals.novelty),
    relevance_score: round(candidate.relevance_score),
  };
  const diversity = context.mode === 'personalized_recommender' ? {
    mmr_score: round(candidate.mmr_score),
    max_similarity_to_previously_selected: round(candidate.max_similarity_to_selected),
    genre_repeat_count: candidate.repeated_genres,
    diversity_penalty: round(candidate.diversity_penalty),
  } : null;
  const details = ['audio-profile similarity'];
  if (candidate.signals.genre_affinity > 0) details.push('genre affinity');
  if (candidate.signals.artist_affinity > 0) details.push('artist affinity');
  if (candidate.signals.novelty > 0.5) details.push('catalog novelty');
  const narrative = context.mode === 'personalized_recommender'
    ? `Ranked by ${details.join(', ')} and selected with diversity-aware re-ranking.`
    : 'Ranked by canonical audio-feature cosine similarity in baseline mode.';
  return {
    strongest_feature_alignments: strongestFeatureAlignments,
    feature_deltas: strongestFeatureAlignments,
    genre_contribution: { matched_genres: matchedGenres, score: round(candidate.signals.genre_affinity) },
    novelty_contribution: { method: context.config.novelty.method, score: round(candidate.signals.novelty) },
    diversity_reranking: diversity,
    ranking_signals: rankingSignals,
    narrative,
  };
}

/** Stage 4: return API-compatible track payloads plus transparent attributions. */
function buildRecommendations(selectedCandidates, context) {
  return selectedCandidates.map((candidate, index) => ({
    rank: index + 1,
    track_id: candidate.track.track_id,
    track_name: candidate.track.track_name,
    artist_name: candidate.track.artist_name,
    genre_name: candidate.track.genre_name || null,
    track_popularity: candidate.track.track_popularity,
    // Raw cosine similarity: a geometric score, not a probability or match percentage.
    similarity_score: round(candidate.raw_similarity),
    relevance_score: round(candidate.relevance_score),
    audio_features: Object.fromEntries(FEATURES.map((feature) => [feature, candidate.track[feature]])),
    explanation: buildExplanation(candidate, context),
  }));
}

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
    return genre
      ? await sql`
          SELECT t.track_id, t.track_name, a.artist_name,
                 STRING_AGG(DISTINCT g.genre_name, ', ') AS genre_name,
                 t.track_popularity,
                 af.danceability, af.energy, af.loudness, af.speechiness,
                 af.acousticness, af.instrumentalness, af.liveness, af.valence, af.tempo
          FROM tracks t JOIN artists a ON a.artist_id = t.artist_id
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
          FROM tracks t JOIN artists a ON a.artist_id = t.artist_id
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

function resolveUserVector(profile, likedRows, mode) {
  const taste = parseJsonValue(profile?.taste_representation);
  const personalizedVector = Array.isArray(taste?.raw_vector) && taste.raw_vector.length === FEATURES.length
    && taste.raw_vector.every((value) => Number.isFinite(Number(value)))
    ? taste.raw_vector.map(Number)
    : null;
  const baselineVector = parseJsonValue(profile?.preference_vector);
  const validBaseline = Array.isArray(baselineVector) && baselineVector.length === FEATURES.length
    && baselineVector.every((value) => Number.isFinite(Number(value)))
    ? baselineVector.map(Number)
    : null;
  if (mode === 'personalized_recommender' && personalizedVector) return personalizedVector;
  if (validBaseline) return validBaseline;
  if (likedRows.length > 0) {
    return FEATURES.map((feature) => (
      likedRows.reduce((sum, row) => sum + Number(row[feature] || 0), 0) / likedRows.length
    ));
  }
  return null;
}

function runRecommendationPipeline(catalog, userRawVector, options) {
  const preprocessing = loadCanonicalPreprocessing();
  if (!preprocessing) {
    throw new Error('Canonical recommendation preprocessing artifact is unavailable. Deploy ml/artifacts/preprocessing.json.');
  }
  const config = loadRecommendationConfig();
  const limit = Math.min(Math.max(Number.parseInt(options.limit, 10) || 20, 1), 50);
  const mode = options.mode === 'baseline_content_recommender'
    ? 'baseline_content_recommender'
    : 'personalized_recommender';
  const seedArtists = options.excludeSeedArtists
    ? (parseJsonValue(options.topArtists) || []).map((artist) => artist.artist || artist.artist_name)
    : [];
  const context = {
    config,
    preprocessing,
    mode,
    limit,
    userRawVector,
    userVector: null,
    dominantGenres: parseJsonValue(options.dominantGenres) || {},
    topArtists: parseJsonValue(options.topArtists) || [],
    excludeTrackIds: new Set(options.excludeTrackIds || []),
    excludeArtistNames: new Set([...(options.excludeArtists || []), ...seedArtists].map(normalizeName)),
  };
  context.userVector = transformForMode(userRawVector, context);
  const retrieved = retrieveCandidates(catalog, context);
  const ranked = mode === 'personalized_recommender'
    ? rankCandidates(retrieved, context)
    : rankBaselineCandidates(retrieved);
  const reranked = mode === 'personalized_recommender'
    ? rerankForDiversity(ranked, context)
    : ranked.slice(0, limit);
  return {
    recommendations: buildRecommendations(reranked, context),
    recommender_mode: mode,
    stats: {
      total_candidates: catalog.length,
      retrieved_candidates: retrieved.length,
      ranked_candidates: ranked.length,
      returned: reranked.length,
      excluded_liked: context.excludeTrackIds.size,
    },
  };
}

async function generateRecommendations(userId, opts = {}) {
  const limit = Math.min(Math.max(Number.parseInt(opts.limit, 10) || 20, 1), 50);
  const genre = opts.genre || null;
  const minPopularity = Math.min(Math.max(Number.parseInt(opts.minPopularity, 10) || 0, 0), 100);
  const requestedMode = opts.mode === 'baseline_content_recommender'
    ? 'baseline_content_recommender'
    : 'personalized_recommender';
  const sql = getDb();
  const profileRows = await sql`
    SELECT preference_vector, taste_representation, dominant_genres, top_artists
    FROM user_profile_data WHERE user_id = ${userId} LIMIT 1
  `;
  const likedRows = await sql`
    SELECT af.danceability, af.energy, af.loudness, af.speechiness,
           af.acousticness, af.instrumentalness, af.liveness, af.valence, af.tempo
    FROM user_liked_tracks ult JOIN audio_features af ON af.track_id = ult.catalog_track_id
    WHERE ult.user_id = ${userId} LIMIT 100
  `.catch(() => []);
  const profile = profileRows[0] || null;
  const persistedTaste = parseJsonValue(profile?.taste_representation);
  const hasPersonalizedTaste = Array.isArray(persistedTaste?.raw_vector)
    && persistedTaste.raw_vector.length === FEATURES.length
    && persistedTaste.raw_vector.every((value) => Number.isFinite(Number(value)));
  const mode = requestedMode === 'personalized_recommender' && hasPersonalizedTaste
    ? 'personalized_recommender'
    : 'baseline_content_recommender';
  const userRawVector = resolveUserVector(profile, likedRows, mode);
  if (!userRawVector) {
    return {
      recommendations: [],
      stats: { total_candidates: 0, retrieved_candidates: 0, ranked_candidates: 0, returned: 0 },
      noProfileReason: 'Connect Spotify and run your music analysis first, or like some catalog tracks.',
    };
  }
  const likedIdRows = await sql`
    SELECT catalog_track_id FROM user_liked_tracks WHERE user_id = ${userId}
  `.catch(() => []);
  const catalog = await loadCandidates(sql, genre, minPopularity);
  const result = runRecommendationPipeline(catalog, userRawVector, {
    limit,
    mode,
    dominantGenres: profile?.dominant_genres,
    topArtists: profile?.top_artists,
    excludeTrackIds: likedIdRows.map((row) => row.catalog_track_id),
    excludeArtists: opts.excludeArtists,
    excludeSeedArtists: opts.excludeSeedArtists,
  });
  return {
    ...result,
    taste_profile_metadata: persistedTaste?.metadata || null,
  };
}

async function generateRecommendationsFromVector(userRawVector, opts = {}) {
  const sql = getDb();
  const catalog = await loadCandidates(sql, opts.genre || null, Math.min(Math.max(Number.parseInt(opts.minPopularity, 10) || 0, 0), 100));
  return runRecommendationPipeline(catalog, userRawVector, {
    limit: opts.limit,
    mode: 'baseline_content_recommender',
    dominantGenres: opts.userGenres,
    topArtists: opts.topArtists,
    excludeTrackIds: opts.excludeTrackIds,
    excludeArtists: opts.excludeArtists,
    excludeSeedArtists: opts.excludeSeedArtists,
  });
}

module.exports = {
  generateRecommendations,
  generateRecommendationsFromVector,
  retrieveCandidates,
  rankCandidates,
  rankBaselineCandidates,
  rerankForDiversity,
  buildRecommendations,
  loadCanonicalPreprocessing,
  FEATURES,
  cosineSimilarity,
  computeScalingParams,
  standardize,
};

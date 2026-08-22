/**
 * api/_lib/recommender.js
 * Server-side MusicLens content-based recommendation engine.
 *
 * Algorithm (mirrors pipeline/utils/recommender.py and frontend recommenderClient.js):
 *   1. Load the user's preference_vector from user_profile_data (9-dim, raw means).
 *   2. Also pull any manual liked tracks and blend them into the user vector.
 *   3. Load candidate tracks from track_feature_vectors (or base tables as fallback).
 *   4. Z-score standardize BOTH the user vector AND all candidate vectors using
 *      catalog-derived means/stds (computed once per request from the candidate set).
 *   5. Compute cosine similarity between standardized user vector and each candidate.
 *   6. Exclude already-liked and seed tracks.
 *   7. Rank by similarity, apply genre/popularity filters, return top N.
 *   8. Generate per-feature explainability with natural-language narrative.
 *
 * RECOMMENDATION_FEATURES order (must match profileCalculator.js and Python config.py):
 *   [danceability, energy, loudness, speechiness, acousticness,
 *    instrumentalness, liveness, valence, tempo]
 *
 * Important: the preference_vector is raw (unscaled) mean values.
 * Standardization is applied here so both user and catalog are in the same space.
 */

'use strict';

const { getDb } = require('./db');

const FEATURES = [
  'danceability', 'energy', 'loudness', 'speechiness',
  'acousticness', 'instrumentalness', 'liveness', 'valence', 'tempo',
];

// ── Math helpers ──────────────────────────────────────────────────────────

function mean(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function std(arr, m) {
  if (arr.length < 2) return 1; // avoid division by zero
  const mu = m ?? mean(arr);
  const variance = arr.reduce((s, x) => s + (x - mu) ** 2, 0) / arr.length;
  return Math.sqrt(variance) || 1;
}

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

// ── Standardization ───────────────────────────────────────────────────────

/**
 * Compute per-feature mean and std from a set of candidate rows.
 * Returns { featureName: { mean, std } }
 */
function computeScalingParams(rows) {
  const params = {};
  for (const feat of FEATURES) {
    const vals = rows.map((r) => Number(r[feat])).filter((v) => !isNaN(v));
    const m = mean(vals);
    params[feat] = { mean: m, std: std(vals, m) };
  }
  return params;
}

/**
 * Z-score a single feature vector using pre-computed scaling params.
 * Returns Float64Array of length FEATURES.length.
 */
function standardize(rawVector, params) {
  return FEATURES.map((feat, i) => {
    const { mean: mu, std: sigma } = params[feat];
    return (rawVector[i] - mu) / sigma;
  });
}

// ── Explainability ────────────────────────────────────────────────────────

const FEATURE_LABELS = {
  danceability: 'danceability', energy: 'energy', loudness: 'loudness',
  speechiness: 'speechiness', acousticness: 'acousticness',
  instrumentalness: 'instrumentalness', liveness: 'liveness',
  valence: 'mood/valence', tempo: 'tempo',
};

/**
 * Given user and track raw vectors + scaling params, produce feature-level explanation.
 */
function buildExplanation(userRaw, trackRaw, scalingParams, trackGenre, userGenres) {
  // Per-feature absolute difference in standardized space → proximity %
  const featureDetails = FEATURES.map((feat, i) => {
    const { mean: mu, std: sigma } = scalingParams[feat];
    const uScaled = (userRaw[i] - mu) / sigma;
    const tScaled = (trackRaw[i] - mu) / sigma;
    const diff = Math.abs(uScaled - tScaled);
    // Proximity: 1 std diff → 50%, 0 diff → 100%
    const proximityPct = Math.max(0, Math.round((1 - diff / 2) * 100));
    return {
      feature: feat,
      userValue: Math.round(userRaw[i] * 1000) / 1000,
      trackValue: Math.round(trackRaw[i] * 1000) / 1000,
      difference: Math.round((trackRaw[i] - userRaw[i]) * 1000) / 1000,
      proximityPct,
    };
  });

  // Top 3 closest features
  const topFeatures = [...featureDetails]
    .sort((a, b) => b.proximityPct - a.proximityPct)
    .slice(0, 3);

  // Genre overlap
  const sharesGenre = trackGenre && userGenres
    ? trackGenre.split(', ').some((g) => userGenres[g.trim()])
    : false;

  // Natural language narrative
  const topLabels = topFeatures.map((f) => FEATURE_LABELS[f.feature] || f.feature);
  let narrative;
  if (topFeatures[0].proximityPct >= 85) {
    narrative = `Strong match for your ${topLabels[0]} and ${topLabels[1]} preferences.`;
  } else if (topFeatures[0].proximityPct >= 70) {
    narrative = `Recommended because its ${topLabels.join(', ')} closely match your MusicLens profile.`;
  } else {
    narrative = `Shares similar ${topLabels[0]} characteristics with your listening history.`;
  }
  if (sharesGenre) {
    narrative += ` Also matches your dominant genre taste.`;
  }

  return {
    topMatchingFeatures: topFeatures.map((f) => ({
      feature: f.feature,
      proximityPct: f.proximityPct,
      userValue: f.userValue,
      trackValue: f.trackValue,
      difference: f.difference,
    })),
    featureDetails,
    sharesGenre,
    narrative,
  };
}

// ── Catalog loader (shared by recommendations + blend) ────────────────────

/**
 * Load candidate tracks from the MusicLens catalog.
 * Prefers the materialized view; falls back to base tables.
 */
async function loadCandidates(sql, genre, minPop) {
  try {
    return genre
      ? await sql`
          SELECT track_id, track_name, artist_name, genre_name, track_popularity,
                 danceability, energy, loudness, speechiness, acousticness,
                 instrumentalness, liveness, valence, tempo
          FROM track_feature_vectors
          WHERE track_popularity >= ${minPop}
            AND genre_name ILIKE ${'%' + genre + '%'}
          ORDER BY track_popularity DESC
        `
      : await sql`
          SELECT track_id, track_name, artist_name, genre_name, track_popularity,
                 danceability, energy, loudness, speechiness, acousticness,
                 instrumentalness, liveness, valence, tempo
          FROM track_feature_vectors
          WHERE track_popularity >= ${minPop}
          ORDER BY track_popularity DESC
        `;
  } catch {
    // Fallback to base tables if materialized view unavailable
    return genre
      ? await sql`
          SELECT t.track_id, t.track_name, a.artist_name,
                 STRING_AGG(DISTINCT g.genre_name, ', ') AS genre_name,
                 t.track_popularity,
                 af.danceability, af.energy, af.loudness, af.speechiness,
                 af.acousticness, af.instrumentalness, af.liveness, af.valence, af.tempo
          FROM tracks t
          JOIN artists a        ON a.artist_id = t.artist_id
          JOIN audio_features af ON af.track_id = t.track_id
          LEFT JOIN playlist_tracks pt ON pt.track_id = t.track_id
          LEFT JOIN genres g    ON g.genre_id = pt.genre_id
          WHERE t.track_popularity >= ${minPop}
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
          JOIN artists a        ON a.artist_id = t.artist_id
          JOIN audio_features af ON af.track_id = t.track_id
          LEFT JOIN playlist_tracks pt ON pt.track_id = t.track_id
          LEFT JOIN genres g    ON g.genre_id = pt.genre_id
          WHERE t.track_popularity >= ${minPop}
          GROUP BY t.track_id, t.track_name, a.artist_name, t.track_popularity,
                   af.danceability, af.energy, af.loudness, af.speechiness,
                   af.acousticness, af.instrumentalness, af.liveness, af.valence, af.tempo
        `;
  }
}

// ── Score and rank candidates against a preference vector ─────────────────

function scoreAndRank(candidates, userRawVector, userGenres, excludeIds, limit) {
  if (!candidates || candidates.length === 0) {
    return { recommendations: [], stats: { total_candidates: 0, returned: 0, excluded_liked: excludeIds.size } };
  }

  const scalingParams = computeScalingParams(candidates);
  const userScaled = standardize(userRawVector, scalingParams);

  const scored = [];
  for (const track of candidates) {
    if (excludeIds.has(track.track_id)) continue;

    const trackRaw = FEATURES.map((f) => Number(track[f]) || 0);
    const trackScaled = standardize(trackRaw, scalingParams);
    const score = cosineSimilarity(userScaled, trackScaled);

    scored.push({ track, trackRaw, score });
  }

  // Sort by similarity descending
  scored.sort((a, b) => b.score - a.score);

  // Build top N results with explainability
  const topN = scored.slice(0, limit);
  const recommendations = topN.map((item, idx) => {
    const { track, trackRaw, score } = item;
    const explanation = buildExplanation(userRawVector, trackRaw, scalingParams, track.genre_name, userGenres);

    return {
      rank: idx + 1,
      track_id: track.track_id,
      track_name: track.track_name,
      artist_name: track.artist_name,
      genre_name: track.genre_name || null,
      track_popularity: track.track_popularity,
      similarity_score: Math.round(score * 10000) / 10000,
      similarity_pct: Math.round(score * 1000) / 10,
      audio_features: {
        danceability: track.danceability,
        energy: track.energy,
        loudness: track.loudness,
        valence: track.valence,
        tempo: track.tempo,
        acousticness: track.acousticness,
        speechiness: track.speechiness,
        instrumentalness: track.instrumentalness,
        liveness: track.liveness,
      },
      explanation,
    };
  });

  return {
    recommendations,
    stats: {
      total_candidates: candidates.length,
      returned: recommendations.length,
      excluded_liked: excludeIds.size,
    },
  };
}

// ── Main recommendation function ──────────────────────────────────────────

/**
 * Generate server-side personalized recommendations for a user.
 *
 * @param {string} userId
 * @param {{ limit?: number, genre?: string, minPopularity?: number }} opts
 * @returns {{ recommendations: Array, stats: object, noProfileReason?: string }}
 */
async function generateRecommendations(userId, opts = {}) {
  const limit = Math.min(Math.max(parseInt(opts.limit) || 20, 1), 50);
  const genre = opts.genre || null;
  const minPop = Math.min(Math.max(parseInt(opts.minPopularity) || 0, 0), 100);

  const sql = getDb();

  // ── 1. Load user preference vector ────────────────────────────────────
  const profileRows = await sql`
    SELECT preference_vector, dominant_genres, raw_feature_means
    FROM user_profile_data
    WHERE user_id = ${userId}
    LIMIT 1
  `;

  // ── 2. Also load manually liked tracks for blending ───────────────────
  const likedRows = await sql`
    SELECT
      af.danceability, af.energy, af.loudness, af.speechiness,
      af.acousticness, af.instrumentalness, af.liveness, af.valence, af.tempo
    FROM user_liked_tracks ult
    JOIN audio_features af ON af.track_id = ult.catalog_track_id
    WHERE ult.user_id = ${userId}
    LIMIT 100
  `.catch(() => []);

  const hasProfile = profileRows.length > 0 && profileRows[0].preference_vector;
  const hasLikes   = likedRows.length > 0;

  if (!hasProfile && !hasLikes) {
    return {
      recommendations: [],
      stats: { total_candidates: 0, returned: 0 },
      noProfileReason: 'Connect Spotify and run your music analysis first, or like some catalog tracks.',
    };
  }

  // Blend preference_vector with liked track vectors (equal weight)
  let userRawVector;
  if (hasProfile) {
    const pv = Array.isArray(profileRows[0].preference_vector)
      ? profileRows[0].preference_vector
      : JSON.parse(profileRows[0].preference_vector);

    if (hasLikes) {
      // Average profile vector with mean of liked vectors
      const likedMeans = FEATURES.map((feat, i) => {
        const vals = likedRows.map((r) => Number(r[feat])).filter((v) => !isNaN(v));
        return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : pv[i];
      });
      userRawVector = FEATURES.map((_, i) => (pv[i] + likedMeans[i]) / 2);
    } else {
      userRawVector = pv;
    }
  } else {
    // Likes only
    userRawVector = FEATURES.map((feat) => {
      const vals = likedRows.map((r) => Number(r[feat])).filter((v) => !isNaN(v));
      return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0.5;
    });
  }

  const userGenres = hasProfile
    ? (profileRows[0].dominant_genres || {})
    : {};

  // ── 3. Load liked track IDs to exclude from recommendations ───────────
  const likedIdRows = await sql`
    SELECT catalog_track_id FROM user_liked_tracks WHERE user_id = ${userId}
  `.catch(() => []);
  const likedIds = new Set(likedIdRows.map((r) => r.catalog_track_id));

  // ── 4. Load candidate tracks ───────────────────────────────────────────
  const candidates = await loadCandidates(sql, genre, minPop);

  // ── 5–8. Score, rank, explain ──────────────────────────────────────────
  return scoreAndRank(candidates, userRawVector, userGenres, likedIds, limit);
}

// ── Vector-based recommendations (used by Friend Blend) ───────────────────

/**
 * Generate recommendations from a custom preference vector.
 * Same algorithm as generateRecommendations but accepts a pre-computed vector
 * instead of loading one from user_profile_data.
 *
 * @param {number[]} userRawVector - 9-dim raw feature means
 * @param {{ limit?, genre?, minPopularity?, excludeTrackIds?: string[], userGenres?: object }} opts
 */
async function generateRecommendationsFromVector(userRawVector, opts = {}) {
  const limit = Math.min(Math.max(parseInt(opts.limit) || 20, 1), 50);
  const genre = opts.genre || null;
  const minPop = Math.min(Math.max(parseInt(opts.minPopularity) || 0, 0), 100);
  const excludeIds = new Set(opts.excludeTrackIds || []);
  const userGenres = opts.userGenres || {};

  const sql = getDb();
  const candidates = await loadCandidates(sql, genre, minPop);
  return scoreAndRank(candidates, userRawVector, userGenres, excludeIds, limit);
}

module.exports = {
  generateRecommendations,
  generateRecommendationsFromVector,
  FEATURES,
  cosineSimilarity,
  computeScalingParams,
  standardize,
};

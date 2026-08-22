/**
 * api/_lib/blender.js
 * Friend Blend — server-side taste comparison engine.
 *
 * Compares two MusicLens user profiles using their persisted preference_vectors
 * (9-dim raw feature means) and dominant_genres. Never accesses raw Spotify data.
 *
 * ═══════════════════════════════════════════════════════════════════
 * BLEND SCORE FORMULA
 * ═══════════════════════════════════════════════════════════════════
 *
 * For each of the 9 audio features, compute a per-feature compatibility:
 *
 *   For bounded features [0, 1] (danceability, energy, speechiness,
 *   acousticness, instrumentalness, liveness, valence):
 *     compat = (1 - |A - B|) × 100
 *
 *   For loudness [-60, 0]:
 *     normalize: norm = (val + 60) / 60  →  [0, 1]
 *     compat = (1 - |normA - normB|) × 100
 *
 *   For tempo [40, 250]:
 *     normalize: norm = (val - 40) / 210  →  ~[0, 1]
 *     compat = (1 - |normA - normB|) × 100
 *
 * Overall Blend Score = weighted average:
 *   70% × mean(feature compatibilities)
 *   30% × genre overlap (cosine similarity of genre-percentage vectors)
 *
 * Result: 0 – 100 scale. Identical profiles → ~100. Very different → lower.
 *
 * ═══════════════════════════════════════════════════════════════════
 * SHARED RECOMMENDATIONS
 * ═══════════════════════════════════════════════════════════════════
 *
 * combined_vector = average(A.preference_vector, B.preference_vector)
 *   → scored against MusicLens catalog via the same cosine-similarity
 *     engine as generateRecommendationsFromVector (recommender.js)
 *   → excludes tracks liked by either user
 *
 * ═══════════════════════════════════════════════════════════════════
 */

'use strict';

const { getDb } = require('./db');
const {
  generateRecommendationsFromVector,
  FEATURES,
  cosineSimilarity,
} = require('./recommender');

// ── Feature normalization for per-feature compatibility ───────────────────

const FEATURE_RANGES = {
  danceability:     { min: 0, max: 1 },
  energy:           { min: 0, max: 1 },
  loudness:         { min: -60, max: 0 },
  speechiness:      { min: 0, max: 1 },
  acousticness:     { min: 0, max: 1 },
  instrumentalness: { min: 0, max: 1 },
  liveness:         { min: 0, max: 1 },
  valence:          { min: 0, max: 1 },
  tempo:            { min: 40, max: 250 },
};

function normalizeFeature(feat, val) {
  const { min, max } = FEATURE_RANGES[feat];
  return Math.max(0, Math.min(1, (val - min) / (max - min)));
}

// ── Per-feature compatibility ─────────────────────────────────────────────

function computeFeatureCompatibility(vecA, vecB) {
  return FEATURES.map((feat, i) => {
    const a = vecA[i];
    const b = vecB[i];
    const normA = normalizeFeature(feat, a);
    const normB = normalizeFeature(feat, b);
    const diff = Math.abs(normA - normB);
    const compat = Math.round((1 - diff) * 1000) / 10; // one decimal
    return {
      feature: feat,
      userA: Math.round(a * 1000) / 1000,
      userB: Math.round(b * 1000) / 1000,
      difference: Math.round((a - b) * 1000) / 1000,
      compatibility: compat, // 0–100
    };
  });
}

// ── Genre analysis ────────────────────────────────────────────────────────

function computeGenreAnalysis(genresA, genresB) {
  const keysA = new Set(Object.keys(genresA || {}));
  const keysB = new Set(Object.keys(genresB || {}));
  const allKeys = new Set([...keysA, ...keysB]);

  // Shared / unique genres
  const shared = [...allKeys].filter((g) => keysA.has(g) && keysB.has(g)).map((g) => ({
    genre: g,
    pctA: genresA[g],
    pctB: genresB[g],
  }));
  const onlyA = [...keysA].filter((g) => !keysB.has(g)).map((g) => ({ genre: g, pct: genresA[g] }));
  const onlyB = [...keysB].filter((g) => !keysA.has(g)).map((g) => ({ genre: g, pct: genresB[g] }));

  // Cosine similarity of genre-percentage vectors
  let dot = 0, nA = 0, nB = 0;
  for (const g of allKeys) {
    const a = genresA[g] || 0;
    const b = genresB[g] || 0;
    dot += a * b;
    nA += a * a;
    nB += b * b;
  }
  const denom = Math.sqrt(nA) * Math.sqrt(nB);
  const genreSimilarity = denom === 0 ? 0 : dot / denom;

  return {
    shared: shared.sort((a, b) => Math.min(b.pctA, b.pctB) - Math.min(a.pctA, a.pctB)),
    onlyA: onlyA.sort((a, b) => b.pct - a.pct),
    onlyB: onlyB.sort((a, b) => b.pct - a.pct),
    similarity: Math.round(genreSimilarity * 1000) / 10, // 0–100
  };
}

// ── Blend Score ───────────────────────────────────────────────────────────

function computeBlendScore(featureCompats, genreSimilarity) {
  const avgFeatureCompat = featureCompats.reduce((s, f) => s + f.compatibility, 0) / featureCompats.length;
  // Weighted: 70% audio features, 30% genre overlap
  const raw = 0.7 * avgFeatureCompat + 0.3 * genreSimilarity;
  return Math.round(raw * 10) / 10; // one decimal
}

// ── Shared traits / biggest differences ───────────────────────────────────

function computeTraits(featureCompats) {
  const sorted = [...featureCompats].sort((a, b) => b.compatibility - a.compatibility);
  const sharedTraits = sorted.slice(0, 3).map((f) => ({
    feature: f.feature,
    compatibility: f.compatibility,
    label: f.compatibility >= 90 ? 'Very similar'
         : f.compatibility >= 75 ? 'Similar'
         : 'Moderate',
  }));
  const biggestDiffs = sorted.slice(-3).reverse().map((f) => ({
    feature: f.feature,
    compatibility: f.compatibility,
    label: f.compatibility < 50 ? 'Very different'
         : f.compatibility < 70 ? 'Different'
         : 'Slight difference',
  }));
  return { sharedTraits, biggestDiffs };
}

// ── Main blend calculation ────────────────────────────────────────────────

/**
 * Calculate the full Friend Blend result between two user profiles.
 *
 * @param {object} profileA - user_profile_data row for creator
 * @param {object} profileB - user_profile_data row for participant
 * @param {string} userIdA  - creator user ID (for excluding liked tracks)
 * @param {string} userIdB  - participant user ID (for excluding liked tracks)
 * @returns {object} Blend result with score, features, genres, recs
 */
async function calculateBlend(profileA, profileB, userIdA, userIdB) {
  // 1. Extract preference vectors
  const vecA = Array.isArray(profileA.preference_vector)
    ? profileA.preference_vector
    : JSON.parse(profileA.preference_vector);
  const vecB = Array.isArray(profileB.preference_vector)
    ? profileB.preference_vector
    : JSON.parse(profileB.preference_vector);

  // 2. Per-feature compatibility
  const featureCompatibility = computeFeatureCompatibility(vecA, vecB);

  // 3. Genre analysis
  const genresA = profileA.dominant_genres || {};
  const genresB = profileB.dominant_genres || {};
  const genreAnalysis = computeGenreAnalysis(genresA, genresB);

  // 4. Blend score
  const blendScore = computeBlendScore(featureCompatibility, genreAnalysis.similarity);

  // 5. Shared traits / biggest differences
  const { sharedTraits, biggestDiffs } = computeTraits(featureCompatibility);

  // 6. Cosine similarity of raw preference vectors (additional metric)
  const rawCosineSim = cosineSimilarity(vecA, vecB);
  const vectorSimilarity = Math.round(rawCosineSim * 1000) / 10;

  // 7. Combined vector for shared recommendations
  const combinedVector = FEATURES.map((_, i) => (vecA[i] + vecB[i]) / 2);

  // Merge dominant genres for the combined recommendation context
  const combinedGenres = {};
  for (const [g, p] of Object.entries(genresA)) combinedGenres[g] = (combinedGenres[g] || 0) + p / 2;
  for (const [g, p] of Object.entries(genresB)) combinedGenres[g] = (combinedGenres[g] || 0) + p / 2;

  // 8. Collect liked track IDs from both users to exclude
  const sql = getDb();
  const likedA = await sql`
    SELECT catalog_track_id FROM user_liked_tracks WHERE user_id = ${userIdA}
  `.catch(() => []);
  const likedB = await sql`
    SELECT catalog_track_id FROM user_liked_tracks WHERE user_id = ${userIdB}
  `.catch(() => []);
  const excludeIds = [
    ...likedA.map((r) => r.catalog_track_id),
    ...likedB.map((r) => r.catalog_track_id),
  ];

  // 9. Generate shared recommendations using the combined vector
  const recsResult = await generateRecommendationsFromVector(combinedVector, {
    limit: 15,
    excludeTrackIds: excludeIds,
    userGenres: combinedGenres,
  });

  // Enhance explanations to reference both users
  const sharedRecommendations = recsResult.recommendations.map((rec) => ({
    ...rec,
    explanation: {
      ...rec.explanation,
      narrative: rec.explanation.narrative
        .replace(/your /gi, 'both users\' ')
        .replace(/your$/gi, 'both users\'')
        + ' Great pick for a shared listening session.',
    },
  }));

  // 10. Artist overlap
  const artistsA = (profileA.top_artists || []).map((a) => a.artist);
  const artistsB = (profileB.top_artists || []).map((a) => a.artist);
  const sharedArtists = artistsA.filter((a) => artistsB.includes(a));

  return {
    blendScore,
    vectorSimilarity,
    featureCompatibility,
    genreAnalysis,
    sharedTraits,
    biggestDifferences: biggestDiffs,
    sharedArtists,
    sharedRecommendations,
    stats: recsResult.stats,
    calculatedAt: new Date().toISOString(),
  };
}

module.exports = { calculateBlend };

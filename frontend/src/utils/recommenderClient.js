/**
 * MusicLens — Client-Side Explainable Recommendation & Profiling Engine
 * 
 * Replicates the Python ContentBasedRecommender in high-performance JavaScript.
 * Enables instant, zero-latency recommendations directly in the browser over
 * the 2,500 curated search catalog without round-trip network delays.
 */

export const FEATURE_COLS = [
  'danceability',
  'energy',
  'loudness',
  'speechiness',
  'acousticness',
  'instrumentalness',
  'liveness',
  'valence',
  'tempo'
];

/**
 * Apply catalog-level feature statistics from analytics exports.
 * Used so the browser recommender matches the Python pipeline scaler.
 */
export function applyDatasetStats(ranges) {
  if (!ranges || typeof ranges !== 'object') return;
  FEATURE_COLS.forEach((feat) => {
    const r = ranges[feat];
    if (!r) return;
    const min = Number(r.min ?? 0);
    const max = Number(r.max ?? 0);
    const span = Number(r.span ?? (max - min)) || 1;
    DATASET_STATS[feat] = {
      mean: Number(r.mean ?? 0),
      std: Number(r.std || 1),
      min,
      max,
      span,
    };
  });
}

// Global catalog dataset statistical parameters (computed from 28,352 tracks)
export const DATASET_STATS = {
  danceability:     { mean: 0.6548, std: 0.1451, min: 0.0, max: 0.983, span: 0.983 },
  energy:           { mean: 0.6986, std: 0.1809, min: 0.0, max: 1.0, span: 1.0 },
  loudness:         { mean: -6.7196, std: 2.9912, min: -46.448, max: 1.275, span: 47.723 },
  speechiness:      { mean: 0.1071, std: 0.1013, min: 0.0, max: 0.918, span: 0.918 },
  acousticness:     { mean: 0.1753, std: 0.2196, min: 0.0, max: 0.994, span: 0.994 },
  instrumentalness: { mean: 0.0847, std: 0.2242, min: 0.0, max: 0.994, span: 0.994 },
  liveness:         { mean: 0.1902, std: 0.1543, min: 0.0, max: 0.996, span: 0.996 },
  valence:          { mean: 0.5105, std: 0.2331, min: 0.0, max: 0.991, span: 0.991 },
  tempo:            { mean: 122.06, std: 26.91, min: 0.0, max: 239.44, span: 239.44 }
};

/**
 * Classify listening personality archetype from average audio feature values.
 */
export function determinePersonalityArchetype(features) {
  const energy = features.energy ?? 0.5;
  const danceability = features.danceability ?? 0.5;
  const valence = features.valence ?? 0.5;
  const acousticness = features.acousticness ?? 0.5;
  const instrumentalness = features.instrumentalness ?? 0.0;
  const speechiness = features.speechiness ?? 0.0;

  if (instrumentalness >= 0.35) {
    return {
      archetype: "Atmospheric & Instrumental Dreamer",
      tagline: "Drawn to rich textures, ambient soundscapes, and non-vocal melodies.",
      description: "Your listening patterns prioritize deep focus, hypnotic soundscapes, and instrumental arrangements over vocal hooks."
    };
  } else if (acousticness >= 0.50 && energy < 0.55) {
    return {
      archetype: "Acoustic & Introspective Soul",
      tagline: "Cherishes organic instruments, warm acoustics, and emotional depth.",
      description: "You lean heavily toward stripped-down productions, natural acoustic textures, and reflective melodies."
    };
  } else if (energy >= 0.75 && danceability >= 0.70) {
    return {
      archetype: "High-Energy Party Enthusiast",
      tagline: "Thrives on driving rhythms, electrifying drops, and dancefloor anthems.",
      description: "Your taste is optimized for high-bpm peak moments, heavy bass, and unstoppable dance grooves."
    };
  } else if (valence >= 0.65 && danceability >= 0.60) {
    return {
      archetype: "Euphoric Groove Explorer",
      tagline: "Radiates positive vibes, infectious hooks, and sun-drenched melodies.",
      description: "You gravitate toward cheerful, uplifting musical keys that bring joy, bounce, and optimism."
    };
  } else if (energy >= 0.72 && valence < 0.45) {
    return {
      archetype: "Nocturnal Adrenaline Seeker",
      tagline: "Passionate about intense beats, minor keys, and dark electronic tension.",
      description: "Your profile favors aggressive energy and brooding atmospheres that deliver dramatic emotional impact."
    };
  } else if (speechiness >= 0.15 && danceability >= 0.60) {
    return {
      archetype: "Lyrical Flow & Rhythm Connoisseur",
      tagline: "Attuned to intricate wordplay, rhythmic cadences, and urban beats.",
      description: "You value rapid-fire vocal deliveries, sophisticated phrasing, and rhythmic storytelling."
    };
  } else if (energy < 0.50 && valence >= 0.50) {
    return {
      archetype: "Chill Vibester & Sunday Lounger",
      tagline: "Loves laid-back tempos, warm chords, and relaxed contentment.",
      description: "Your playlist creates a soothing, comforting sanctuary with mid-to-low tempo gems."
    };
  } else {
    return {
      archetype: "Eclectic Sonic Connoisseur",
      tagline: "A well-rounded listener with dynamic, multi-dimensional musical tastes.",
      description: "You refuse to be boxed into one lane, finding harmony across diverse energies, moods, and styles."
    };
  }
}

/**
 * Standardize a 9-dimensional audio feature vector using Z-scores.
 */
function standardizeVector(song) {
  return FEATURE_COLS.map(feat => {
    const val = Number(song[feat] ?? 0);
    const { mean, std } = DATASET_STATS[feat];
    return (val - mean) / (std || 1);
  });
}

/**
 * Calculate Cosine Similarity between two 1D numeric vectors.
 */
function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Compute the complete User Music Profile from selected seed songs.
 */
export function computeUserProfile(selectedSongs) {
  if (!selectedSongs || selectedSongs.length === 0) {
    return null;
  }

  const count = selectedSongs.length;
  const rawMeans = {};
  FEATURE_COLS.forEach(feat => {
    const sum = selectedSongs.reduce((acc, s) => acc + Number(s[feat] || 0), 0);
    rawMeans[feat] = Number((sum / count).toFixed(4));
  });

  const avgPopularity = Number(
    (selectedSongs.reduce((acc, s) => acc + Number(s.track_popularity || 0), 0) / count).toFixed(1)
  );

  // Dominant genres breakdown
  const genreCounts = {};
  selectedSongs.forEach(s => {
    const g = s.genre || 'pop';
    genreCounts[g] = (genreCounts[g] || 0) + 1;
  });
  const dominantGenres = Object.entries(genreCounts)
    .map(([genre, cnt]) => ({ genre, count: cnt, percentage: Number(((cnt / count) * 100).toFixed(1)) }))
    .sort((a, b) => b.count - a.count);

  // Mood quadrant distribution
  const moods = { "Upbeat / Euphoric": 0, "Chill / Peaceful": 0, "Intense / Aggressive": 0, "Melancholic / Sad": 0 };
  selectedSongs.forEach(s => {
    const e = s.energy ?? 0.5;
    const v = s.valence ?? 0.5;
    if (e >= 0.5 && v >= 0.5) moods["Upbeat / Euphoric"]++;
    else if (e < 0.5 && v >= 0.5) moods["Chill / Peaceful"]++;
    else if (e >= 0.5 && v < 0.5) moods["Intense / Aggressive"]++;
    else moods["Melancholic / Sad"]++;
  });

  const archetype = determinePersonalityArchetype(rawMeans);

  return {
    seedCount: count,
    archetype: archetype.archetype,
    tagline: archetype.tagline,
    description: archetype.description,
    audioProfile: {
      energyPct: Number((rawMeans.energy * 100).toFixed(1)),
      danceabilityPct: Number((rawMeans.danceability * 100).toFixed(1)),
      valencePct: Number((rawMeans.valence * 100).toFixed(1)),
      acousticnessPct: Number((rawMeans.acousticness * 100).toFixed(1)),
      instrumentalnessPct: Number((rawMeans.instrumentalness * 100).toFixed(1)),
      speechinessPct: Number((rawMeans.speechiness * 100).toFixed(1)),
      livenessPct: Number((rawMeans.liveness * 100).toFixed(1)),
      avgTempoBpm: Number(rawMeans.tempo.toFixed(1)),
      avgLoudnessDb: Number(rawMeans.loudness.toFixed(2)),
      avgPopularity: avgPopularity
    },
    rawMeans,
    dominantGenres,
    moods,
    selectedSongs
  };
}

/**
 * Generate Top-N explainable recommendations based on seed songs.
 */
export function generateRecommendations(catalog, selectedSongs, options = {}) {
  const {
    topN = 10,
    genreFilter = null,
    minPopularity = 0
  } = options;

  if (!selectedSongs || selectedSongs.length === 0 || !catalog || catalog.length === 0) {
    return [];
  }

  const profile = computeUserProfile(selectedSongs);
  const seedIds = new Set(selectedSongs.map(s => s.track_id));

  // 1. Build standardized User Preference Vector (mean of standardized seed vectors)
  const stdSeedVectors = selectedSongs.map(s => standardizeVector(s));
  const userVector = FEATURE_COLS.map((_, colIdx) => {
    const sum = stdSeedVectors.reduce((acc, v) => acc + v[colIdx], 0);
    return sum / stdSeedVectors.length;
  });

  // 2. Filter candidates & calculate cosine similarities
  const candidates = [];
  const topGenre = profile.dominantGenres[0]?.genre?.toLowerCase();

  for (const song of catalog) {
    // Exclude selected seeds
    if (seedIds.has(song.track_id)) continue;

    // Optional genre filter
    if (genreFilter && genreFilter !== 'all') {
      if ((song.genre || '').toLowerCase() !== genreFilter.toLowerCase()) continue;
    }

    // Optional min popularity filter
    if (minPopularity > 0 && (song.track_popularity || 0) < minPopularity) continue;

    const songStdVector = standardizeVector(song);
    const sim = cosineSimilarity(userVector, songStdVector);

    // Compute feature proximities (1 - |rawDelta| / span)
    const featureProximities = {};
    const featureDeltas = {};
    const featureScores = [];

    FEATURE_COLS.forEach(feat => {
      const songVal = Number(song[feat] || 0);
      const userVal = profile.rawMeans[feat] || 0;
      const rawDelta = songVal - userVal;
      const span = DATASET_STATS[feat].span;
      const proxPct = Math.max(0, (1 - Math.abs(rawDelta) / span) * 100);

      featureProximities[feat] = Number(proxPct.toFixed(1));
      featureDeltas[feat] = Number(rawDelta.toFixed(3));
      featureScores.push({ feature: feat, proximity: proxPct, songValue: songVal, userValue: userVal });
    });

    // Top 3 closest feature matches
    featureScores.sort((a, b) => b.proximity - a.proximity);
    const topMatches = featureScores.slice(0, 3);

    // Genre alignment check
    const songGenre = (song.genre || 'other').toLowerCase();
    const sharesGenre = topGenre && songGenre === topGenre;

    // Build natural language narrative explanation
    const feat1 = topMatches[0];
    const feat2 = topMatches[1];
    let narrative = `Strong alignment in ${feat1.feature.charAt(0).toUpperCase() + feat1.feature.slice(1)} (${feat1.proximity.toFixed(0)}% match) and ${feat2.feature.charAt(0).toUpperCase() + feat2.feature.slice(1)} (${feat2.proximity.toFixed(0)}% match)`;
    if (sharesGenre) {
      narrative += `, shares your preferred genre (${song.genre})`;
    }
    narrative += '.';

    candidates.push({
      ...song,
      similarityScore: Number(sim.toFixed(4)),
      similarityPercentage: Number((Math.max(0, sim) * 100).toFixed(1)),
      explanation: {
        topMatchingFeatures: topMatches.map(m => ({
          feature: m.feature,
          similarityPct: Number(m.proximity.toFixed(1)),
          songValue: m.songValue
        })),
        featureProximities,
        featureDeltas,
        sharesGenre,
        narrative
      }
    });
  }

  // 3. Multi-Key Deterministic Sorting:
  // Sort by similarity descending -> popularity descending -> track_id ascending
  candidates.sort((a, b) => {
    if (b.similarityScore !== a.similarityScore) {
      return b.similarityScore - a.similarityScore;
    }
    if (b.track_popularity !== a.track_popularity) {
      return (b.track_popularity || 0) - (a.track_popularity || 0);
    }
    return a.track_id.localeCompare(b.track_id);
  });

  return candidates.slice(0, topN).map((item, idx) => ({
    ...item,
    rank: idx + 1
  }));
}

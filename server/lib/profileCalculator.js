/**
 * server/lib/profileCalculator.js
 * JavaScript implementation of the MusicLens taste-profile & ML pipeline.
 *
 * Computes rich user taste profiles directly from Spotify listening behavior
 * (top tracks, recently played, liked songs, top artists) combined with
 * catalog feature vectors and taxonomy mapping, avoiding per-track N+1 queries.
 *
 * Replicates the archetype logic in pipeline/utils/user_profile.py exactly.
 * Do NOT invent new personality categories.
 *
 * RECOMMENDATION_FEATURES (9 features, matches Python config.py):
 *  danceability, energy, loudness, speechiness, acousticness,
 *  instrumentalness, liveness, valence, tempo
 */

'use strict';

const RECOMMENDATION_FEATURES = [
  'danceability', 'energy', 'loudness', 'speechiness',
  'acousticness', 'instrumentalness', 'liveness', 'valence', 'tempo',
];

const BOUNDED_FEATURES = new Set([
  'danceability', 'energy', 'speechiness', 'acousticness',
  'instrumentalness', 'liveness', 'valence',
]);

const GENRE_AUDIO_PROFILES = {
  edm: {
    danceability: 0.655, energy: 0.802, loudness: -5.42, speechiness: 0.088,
    acousticness: 0.078, instrumentalness: 0.218, liveness: 0.208, valence: 0.401, tempo: 126.1,
  },
  pop: {
    danceability: 0.678, energy: 0.701, loudness: -5.84, speechiness: 0.072,
    acousticness: 0.178, instrumentalness: 0.034, liveness: 0.179, valence: 0.538, tempo: 120.3,
  },
  rap: {
    danceability: 0.718, energy: 0.652, loudness: -6.78, speechiness: 0.216,
    acousticness: 0.168, instrumentalness: 0.012, liveness: 0.189, valence: 0.461, tempo: 120.5,
  },
  'r&b': {
    danceability: 0.670, energy: 0.591, loudness: -7.52, speechiness: 0.108,
    acousticness: 0.224, instrumentalness: 0.028, liveness: 0.172, valence: 0.531, tempo: 115.4,
  },
  rock: {
    danceability: 0.521, energy: 0.771, loudness: -6.18, speechiness: 0.059,
    acousticness: 0.142, instrumentalness: 0.062, liveness: 0.202, valence: 0.537, tempo: 128.5,
  },
  latin: {
    danceability: 0.714, energy: 0.709, loudness: -5.82, speechiness: 0.098,
    acousticness: 0.211, instrumentalness: 0.014, liveness: 0.183, valence: 0.658, tempo: 118.6,
  },
};

const DEFAULT_AUDIO_PROFILE = {
  danceability: 0.650, energy: 0.690, loudness: -6.40, speechiness: 0.090,
  acousticness: 0.180, instrumentalness: 0.050, liveness: 0.190, valence: 0.510, tempo: 121.0,
};

/**
 * Classify a raw genre string or subgenre label into standard MusicLens macro genres.
 * @param {string} rawGenre
 * @returns {string|null} One of 'pop', 'rap', 'rock', 'latin', 'r&b', 'edm', or null
 */
function classifyGenre(rawGenre) {
  if (!rawGenre || typeof rawGenre !== 'string') return null;
  const g = rawGenre.toLowerCase();

  if (/latin|reggaeton|bachata|salsa|urbano|latino|cumbia|corrido|mariachi|bossa/i.test(g)) {
    return 'latin';
  }
  if (/r&b|rnb|soul|neo-soul|funk|motown|quiet storm/i.test(g)) {
    return 'r&b';
  }
  if (/rap|hip hop|hip-hop|trap|drill|grime|phonk|boom bap/i.test(g)) {
    return 'rap';
  }
  if (/rock|metal|punk|alt|grunge|emo|indie rock|hard rock|guitar/i.test(g)) {
    return 'rock';
  }
  if (/edm|electro|house|techno|trance|dubstep|dnb|dance|synth|club|disco|electron/i.test(g)) {
    return 'edm';
  }
  if (/pop|boy band|idol|singer-songwriter|indie pop/i.test(g)) {
    return 'pop';
  }

  return null;
}


/**
 * Determine Music Personality Archetype matching pipeline/utils/user_profile.py.
 */
function determineArchetype(avgFeatures) {
  const energy           = avgFeatures.energy          ?? 0.5;
  const danceability     = avgFeatures.danceability    ?? 0.5;
  const valence          = avgFeatures.valence         ?? 0.5;
  const acousticness     = avgFeatures.acousticness    ?? 0.5;
  const instrumentalness = avgFeatures.instrumentalness ?? 0.0;
  const speechiness      = avgFeatures.speechiness     ?? 0.0;

  if (instrumentalness >= 0.35) {
    return {
      archetype: 'Atmospheric & Instrumental Dreamer',
      tagline: 'Drawn to rich textures, ambient soundscapes, and non-vocal melodies.',
      description: 'Your listening patterns prioritize deep focus, hypnotic soundscapes, and instrumental arrangements over vocal hooks.',
    };
  }
  if (acousticness >= 0.50 && energy < 0.55) {
    return {
      archetype: 'Acoustic & Introspective Soul',
      tagline: 'Cherishes organic instruments, warm acoustics, and emotional depth.',
      description: 'You lean heavily toward stripped-down productions, natural acoustic textures, and reflective melodies.',
    };
  }
  if (energy >= 0.75 && danceability >= 0.70) {
    return {
      archetype: 'High-Energy Party Enthusiast',
      tagline: 'Thrives on driving rhythms, electrifying drops, and dancefloor anthems.',
      description: 'Your taste is optimized for high-bpm peak moments, heavy bass, and unstoppable dance grooves.',
    };
  }
  if (valence >= 0.65 && danceability >= 0.60) {
    return {
      archetype: 'Euphoric Groove Explorer',
      tagline: 'Radiates positive vibes, infectious hooks, and sun-drenched melodies.',
      description: 'You gravitate toward cheerful, uplifting musical keys that bring joy, bounce, and optimism.',
    };
  }
  if (energy >= 0.72 && valence < 0.45) {
    return {
      archetype: 'Nocturnal Adrenaline Seeker',
      tagline: 'Passionate about intense beats, minor keys, and dark electronic tension.',
      description: 'Your profile favors aggressive energy and brooding atmospheres that deliver dramatic emotional impact.',
    };
  }
  if (speechiness >= 0.15 && danceability >= 0.60) {
    return {
      archetype: 'Lyrical Flow & Rhythm Connoisseur',
      tagline: 'Attuned to intricate wordplay, rhythmic cadences, and urban beats.',
      description: 'You value rapid-fire vocal deliveries, sophisticated phrasing, and rhythmic storytelling.',
    };
  }
  if (energy < 0.50 && valence >= 0.50) {
    return {
      archetype: 'Chill Vibester & Sunday Lounger',
      tagline: 'Loves laid-back tempos, warm chords, and relaxed contentment.',
      description: 'Your playlist creates a soothing, comforting sanctuary with mid-to-low tempo gems.',
    };
  }
  return {
    archetype: 'Eclectic Sonic Connoisseur',
    tagline: 'A well-rounded listener with dynamic, multi-dimensional musical tastes.',
    description: 'You refuse to be boxed into one lane, finding harmony across diverse energies, moods, and styles.',
  };
}

/**
 * Derives audio features and genres for each Spotify track using multi-tier resolution:
 *   1. Exact catalog match from track_feature_vectors
 *   2. Artist match from catalog
 *   3. Spotify artist genre mapping + calibrated genre profile
 *   4. Catalog default baseline
 *
 * @param {Array} spotifyTracks
 * @param {Array} spotifyTopArtists
 * @param {Map} catalogTrackMap
 * @param {Map} catalogArtistMap
 */
function deriveTrackFeatures(spotifyTracks, spotifyTopArtists = [], catalogTrackMap = new Map(), catalogArtistMap = new Map()) {
  const artistGenreLookup = new Map();
  for (const a of spotifyTopArtists) {
    if (a.artist_name && Array.isArray(a.genres)) {
      for (const g of a.genres) {
        const classified = classifyGenre(g);
        if (classified) {
          artistGenreLookup.set(a.artist_name.toLowerCase(), classified);
          break;
        }
      }
    }
  }

  const derivedTracks = [];
  let matchedCount = 0;
  let ambiguousCount = 0;
  let unmatchedCount = 0;

  for (const t of spotifyTracks) {
    const sid = t.spotify_track_id;
    const normArtist = (t.artist_name || '').toLowerCase().trim();

    // 1. Exact catalog track hit
    if (sid && catalogTrackMap.has(sid)) {
      const cat = catalogTrackMap.get(sid);
      matchedCount++;
      derivedTracks.push({
        track_id: sid,
        catalog_track_id: cat.track_id,
        track_name: t.track_name || cat.track_name,
        artist_name: t.artist_name || cat.artist_name,
        genre_name: cat.genre_name || null,
        danceability: cat.danceability ?? DEFAULT_AUDIO_PROFILE.danceability,
        energy: cat.energy ?? DEFAULT_AUDIO_PROFILE.energy,
        loudness: cat.loudness ?? DEFAULT_AUDIO_PROFILE.loudness,
        speechiness: cat.speechiness ?? DEFAULT_AUDIO_PROFILE.speechiness,
        acousticness: cat.acousticness ?? DEFAULT_AUDIO_PROFILE.acousticness,
        instrumentalness: cat.instrumentalness ?? DEFAULT_AUDIO_PROFILE.instrumentalness,
        liveness: cat.liveness ?? DEFAULT_AUDIO_PROFILE.liveness,
        valence: cat.valence ?? DEFAULT_AUDIO_PROFILE.valence,
        tempo: cat.tempo ?? DEFAULT_AUDIO_PROFILE.tempo,
        match_status: 'matched',
        source: t.source || 'top_tracks',
        played_at: t.played_at || null,
        added_at: t.added_at || null,
        interaction_count: t.interaction_count || 1,
      });
      continue;
    }

    // 2. Artist match in catalog
    if (normArtist && catalogArtistMap.has(normArtist)) {
      const catArt = catalogArtistMap.get(normArtist);
      ambiguousCount++;
      derivedTracks.push({
        track_id: sid,
        catalog_track_id: null,
        track_name: t.track_name,
        artist_name: t.artist_name,
        genre_name: catArt.genre_name || null,
        danceability: catArt.danceability ?? DEFAULT_AUDIO_PROFILE.danceability,
        energy: catArt.energy ?? DEFAULT_AUDIO_PROFILE.energy,
        loudness: catArt.loudness ?? DEFAULT_AUDIO_PROFILE.loudness,
        speechiness: catArt.speechiness ?? DEFAULT_AUDIO_PROFILE.speechiness,
        acousticness: catArt.acousticness ?? DEFAULT_AUDIO_PROFILE.acousticness,
        instrumentalness: catArt.instrumentalness ?? DEFAULT_AUDIO_PROFILE.instrumentalness,
        liveness: catArt.liveness ?? DEFAULT_AUDIO_PROFILE.liveness,
        valence: catArt.valence ?? DEFAULT_AUDIO_PROFILE.valence,
        tempo: catArt.tempo ?? DEFAULT_AUDIO_PROFILE.tempo,
        match_status: 'ambiguous',
        source: t.source || 'top_tracks',
        played_at: t.played_at || null,
        added_at: t.added_at || null,
        interaction_count: t.interaction_count || 1,
      });
      continue;
    }

    // 3. Spotify artist genre inferred
    const inferredGenre = artistGenreLookup.get(normArtist) || classifyGenre(t.genre_name);
    if (inferredGenre && GENRE_AUDIO_PROFILES[inferredGenre]) {
      const prof = GENRE_AUDIO_PROFILES[inferredGenre];
      ambiguousCount++;
      derivedTracks.push({
        track_id: sid,
        catalog_track_id: null,
        track_name: t.track_name,
        artist_name: t.artist_name,
        genre_name: inferredGenre,
        danceability: prof.danceability,
        energy: prof.energy,
        loudness: prof.loudness,
        speechiness: prof.speechiness,
        acousticness: prof.acousticness,
        instrumentalness: prof.instrumentalness,
        liveness: prof.liveness,
        valence: prof.valence,
        tempo: prof.tempo,
        match_status: 'ambiguous',
        source: t.source || 'top_tracks',
        played_at: t.played_at || null,
        added_at: t.added_at || null,
        interaction_count: t.interaction_count || 1,
      });
      continue;
    }

    // 4. Default baseline
    unmatchedCount++;
    derivedTracks.push({
      track_id: sid,
      catalog_track_id: null,
      track_name: t.track_name,
      artist_name: t.artist_name,
      genre_name: null,
      danceability: DEFAULT_AUDIO_PROFILE.danceability,
      energy: DEFAULT_AUDIO_PROFILE.energy,
      loudness: DEFAULT_AUDIO_PROFILE.loudness,
      speechiness: DEFAULT_AUDIO_PROFILE.speechiness,
      acousticness: DEFAULT_AUDIO_PROFILE.acousticness,
      instrumentalness: DEFAULT_AUDIO_PROFILE.instrumentalness,
      liveness: DEFAULT_AUDIO_PROFILE.liveness,
      valence: DEFAULT_AUDIO_PROFILE.valence,
      tempo: DEFAULT_AUDIO_PROFILE.tempo,
      match_status: 'unmatched',
      source: t.source || 'top_tracks',
      played_at: t.played_at || null,
      added_at: t.added_at || null,
      interaction_count: t.interaction_count || 1,
    });
  }

  const total = derivedTracks.length;
  const coverage_pct = total > 0 ? Math.round(((matchedCount + ambiguousCount) / total) * 100 * 10) / 10 : 0;

  return {
    derivedTracks,
    stats: {
      total,
      matched: matchedCount,
      unmatched: unmatchedCount,
      ambiguous: ambiguousCount,
      coverage_pct,
    },
  };
}

/**
 * Calculates a complete MusicLens taste profile from derived track objects & top artists.
 *
 * @param {Array} derivedTracks
 * @param {object} coverageStats
 * @param {Array} topArtistsFromSpotify
 */
function calculateProfile(
  derivedTracks,
  coverageStats = {},
  topArtistsFromSpotify = [],
  additionalTasteTracks = [],
) {
  const stats = {
    total: coverageStats.total ?? derivedTracks.length,
    matched: coverageStats.matched ?? 0,
    unmatched: coverageStats.unmatched ?? 0,
    ambiguous: coverageStats.ambiguous ?? 0,
    coverage_pct: coverageStats.coverage_pct ?? 0,
  };

  if (!derivedTracks || derivedTracks.length === 0) {
    const archInfo = determineArchetype({});
    return {
      tracks_analyzed: stats.total,
      tracks_matched: stats.matched,
      tracks_unmatched: stats.unmatched,
      tracks_ambiguous: stats.ambiguous,
      coverage_pct: stats.coverage_pct,
      audio_profile: null,
      raw_feature_means: null,
      preference_vector: null,
      taste_representation: null,
      dominant_genres: {},
      dominant_subgenres: {},
      top_artists: [],
      mood_distribution: {},
      archetype: archInfo.archetype,
      archetype_tagline: archInfo.tagline,
      archetype_desc: archInfo.description,
    };
  }

  // ── 1. Legacy baseline audio means (kept for baseline comparison) ──────
  const rawMeans = {};
  for (const feat of RECOMMENDATION_FEATURES) {
    const vals = derivedTracks.map((r) => r[feat]).filter((v) => v != null && !isNaN(v));
    rawMeans[feat] = vals.length > 0
      ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10000) / 10000
      : DEFAULT_AUDIO_PROFILE[feat] ?? 0.5;
  }

  // ── 2. Audio profile (percentage breakdowns for bounded features) ──────
  const audioProfile = {
    energy_pct:           Math.round(rawMeans.energy          * 1000) / 10,
    danceability_pct:     Math.round(rawMeans.danceability    * 1000) / 10,
    valence_pct:          Math.round(rawMeans.valence         * 1000) / 10,
    acousticness_pct:     Math.round(rawMeans.acousticness    * 1000) / 10,
    instrumentalness_pct: Math.round(rawMeans.instrumentalness * 1000) / 10,
    speechiness_pct:      Math.round(rawMeans.speechiness     * 1000) / 10,
    liveness_pct:         Math.round(rawMeans.liveness        * 1000) / 10,
    avg_tempo_bpm:        Math.round(rawMeans.tempo * 10) / 10,
    avg_loudness_db:      Math.round(rawMeans.loudness * 100) / 100,
  };

  // ── 3. Baseline preference vector (for comparison and Friend Blend) ────
  const preferenceVector = RECOMMENDATION_FEATURES.map((f) => rawMeans[f]);

  // The enhanced representation is source-aware and is consumed by the
  // recommendation service. Require lazily to avoid a module cycle because
  // tasteProfile imports the feature-order constant from this module.
  // eslint-disable-next-line global-require
  const { buildTasteRepresentation } = require('./tasteProfile');
  const tasteRepresentation = buildTasteRepresentation([
    ...derivedTracks,
    ...(Array.isArray(additionalTasteTracks) ? additionalTasteTracks : []),
  ]);

  // ── 4. Dominant genres ────────────────────────────────────────────────
  const genreCounts = {};
  let totalGenreHits = 0;

  for (const row of derivedTracks) {
    if (row.genre_name) {
      for (const g of row.genre_name.split(', ')) {
        const classified = classifyGenre(g) || g.trim().toLowerCase();
        if (classified) {
          genreCounts[classified] = (genreCounts[classified] || 0) + 1;
          totalGenreHits++;
        }
      }
    }
  }

  // Also factor in Spotify top artists genres if available
  for (const a of topArtistsFromSpotify) {
    if (Array.isArray(a.genres)) {
      for (const g of a.genres) {
        const classified = classifyGenre(g);
        if (classified) {
          genreCounts[classified] = (genreCounts[classified] || 0) + 2; // slight weight to declared top artist genres
          totalGenreHits += 2;
        }
      }
    }
  }

  // Default fallback if no genres detected
  if (totalGenreHits === 0) {
    genreCounts['pop'] = 1;
    totalGenreHits = 1;
  }

  const dominantGenres = Object.fromEntries(
    Object.entries(genreCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 6)
      .map(([g, c]) => [g, Math.round((c / totalGenreHits) * 1000) / 10])
  );

  // ── 5. Top artists ─────────────────────────────────────────────────────
  const artistCounts = {};
  for (const row of derivedTracks) {
    if (row.artist_name) {
      artistCounts[row.artist_name] = (artistCounts[row.artist_name] || 0) + 1;
    }
  }
  // If top artists from Spotify provided, ensure they are represented
  for (const a of topArtistsFromSpotify) {
    if (a.artist_name) {
      artistCounts[a.artist_name] = (artistCounts[a.artist_name] || 0) + 1;
    }
  }

  const topArtists = Object.entries(artistCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([artist, track_count]) => ({ artist, track_count }));

  // ── 6. Mood quadrant distribution ─────────────────────────────────────
  const moodCounts = {
    'Upbeat / Euphoric': 0,
    'Chill / Peaceful': 0,
    'Intense / Aggressive': 0,
    'Melancholic / Sad': 0,
  };

  for (const row of derivedTracks) {
    const e = row.energy ?? 0.5;
    const v = row.valence ?? 0.5;
    if (e >= 0.5 && v >= 0.5)      moodCounts['Upbeat / Euphoric']++;
    else if (e < 0.5 && v >= 0.5)  moodCounts['Chill / Peaceful']++;
    else if (e >= 0.5 && v < 0.5)  moodCounts['Intense / Aggressive']++;
    else                            moodCounts['Melancholic / Sad']++;
  }

  const totalTracks = Math.max(derivedTracks.length, 1);
  const moodDistribution = Object.fromEntries(
    Object.entries(moodCounts).map(([k, c]) => [k, Math.round((c / totalTracks) * 1000) / 10])
  );

  // ── 7. Personality archetype ───────────────────────────────────────────
  const archetypeInfo = determineArchetype(rawMeans);

  return {
    tracks_analyzed: stats.total,
    tracks_matched: stats.matched,
    tracks_unmatched: stats.unmatched,
    tracks_ambiguous: stats.ambiguous,
    coverage_pct: stats.coverage_pct,
    audio_profile: audioProfile,
    raw_feature_means: rawMeans,
    preference_vector: preferenceVector,
    taste_representation: tasteRepresentation,
    dominant_genres: dominantGenres,
    dominant_subgenres: {},
    top_artists: topArtists,
    mood_distribution: moodDistribution,
    archetype: archetypeInfo.archetype,
    archetype_tagline: archetypeInfo.tagline,
    archetype_desc: archetypeInfo.description,
  };
}

module.exports = {
  calculateProfile,
  deriveTrackFeatures,
  determineArchetype,
  classifyGenre,
  RECOMMENDATION_FEATURES,
  GENRE_AUDIO_PROFILES,
  DEFAULT_AUDIO_PROFILE,
};

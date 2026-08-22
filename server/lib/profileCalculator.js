/**
 * server/lib/profileCalculator.js
 * JavaScript port of the Python UserMusicProfile logic.
 *
 * Calculates the MusicLens user profile from MATCHED catalog tracks only.
 * Unmatched and ambiguous tracks are excluded from audio calculations.
 * (Ambiguous tracks are included because they are real catalog entries —
 *  the uncertainty is about the Spotify-to-catalog link, not the audio data.)
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

function determineArchetype(avgFeatures) {
  const energy          = avgFeatures.energy          ?? 0.5;
  const danceability    = avgFeatures.danceability    ?? 0.5;
  const valence         = avgFeatures.valence         ?? 0.5;
  const acousticness    = avgFeatures.acousticness    ?? 0.5;
  const instrumentalness = avgFeatures.instrumentalness ?? 0.0;
  const speechiness     = avgFeatures.speechiness     ?? 0.0;

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

function calculateProfile(audioRows, coverageStats) {
  if (!audioRows || audioRows.length === 0) {
    const archInfo = determineArchetype({});
    return {
      tracks_analyzed: coverageStats.total,
      tracks_matched: coverageStats.matched,
      tracks_unmatched: coverageStats.unmatched,
      tracks_ambiguous: coverageStats.ambiguous,
      coverage_pct: coverageStats.coverage_pct,
      audio_profile: null,
      raw_feature_means: null,
      preference_vector: null,
      dominant_genres: {},
      dominant_subgenres: {},
      top_artists: [],
      mood_distribution: {},
      archetype: archInfo.archetype,
      archetype_tagline: archInfo.tagline,
      archetype_desc: archInfo.description,
    };
  }

  // ── 1. Average audio features ──────────────────────────────────────────
  const rawMeans = {};
  for (const feat of RECOMMENDATION_FEATURES) {
    const vals = audioRows.map((r) => r[feat]).filter((v) => v != null && !isNaN(v));
    rawMeans[feat] = vals.length > 0
      ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10000) / 10000
      : 0;
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

  // ── 3. Preference vector (for Prompt 4 recommendation engine) ─────────
  const preferenceVector = RECOMMENDATION_FEATURES.map((f) => rawMeans[f]);

  // ── 4. Dominant genres ────────────────────────────────────────────────
  const genreCounts = {};
  for (const row of audioRows) {
    if (row.genre_name) {
      for (const g of row.genre_name.split(', ')) {
        genreCounts[g] = (genreCounts[g] || 0) + 1;
      }
    }
  }
  const total = audioRows.length;
  const dominantGenres = Object.fromEntries(
    Object.entries(genreCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 6)
      .map(([g, c]) => [g, Math.round((c / total) * 1000) / 10])
  );

  // ── 5. Top artists ─────────────────────────────────────────────────────
  const artistCounts = {};
  for (const row of audioRows) {
    if (row.artist_name) {
      artistCounts[row.artist_name] = (artistCounts[row.artist_name] || 0) + 1;
    }
  }
  const topArtists = Object.entries(artistCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([artist, track_count]) => ({ artist, track_count }));

  // ── 6. Mood quadrant distribution ─────────────────────────────────────
  const moodCounts = { 'Upbeat / Euphoric': 0, 'Chill / Peaceful': 0, 'Intense / Aggressive': 0, 'Melancholic / Sad': 0 };
  for (const row of audioRows) {
    const e = row.energy ?? 0.5;
    const v = row.valence ?? 0.5;
    if (e >= 0.5 && v >= 0.5)      moodCounts['Upbeat / Euphoric']++;
    else if (e < 0.5 && v >= 0.5)  moodCounts['Chill / Peaceful']++;
    else if (e >= 0.5 && v < 0.5)  moodCounts['Intense / Aggressive']++;
    else                            moodCounts['Melancholic / Sad']++;
  }
  const moodDistribution = Object.fromEntries(
    Object.entries(moodCounts).map(([k, c]) => [k, Math.round((c / total) * 1000) / 10])
  );

  // ── 7. Personality archetype ───────────────────────────────────────────
  const archetypeInfo = determineArchetype(rawMeans);

  return {
    tracks_analyzed: coverageStats.total,
    tracks_matched:  coverageStats.matched,
    tracks_unmatched: coverageStats.unmatched,
    tracks_ambiguous: coverageStats.ambiguous,
    coverage_pct: coverageStats.coverage_pct,
    audio_profile: audioProfile,
    raw_feature_means: rawMeans,
    preference_vector: preferenceVector,
    dominant_genres: dominantGenres,
    dominant_subgenres: {},
    top_artists: topArtists,
    mood_distribution: moodDistribution,
    archetype: archetypeInfo.archetype,
    archetype_tagline: archetypeInfo.tagline,
    archetype_desc: archetypeInfo.description,
  };
}

module.exports = { calculateProfile, determineArchetype, RECOMMENDATION_FEATURES };

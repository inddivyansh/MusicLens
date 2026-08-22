/**
 * server/routes/recap/index.js
 * GET /api/recap
 * Returns the MusicLens Recap for the authenticated user.
 * Generated from the persisted user_profile_data — does NOT call Spotify,
 * does NOT rebuild the profile, does NOT run recommendations.
 */

'use strict';

const { validateSession } = require('../../lib/session');
const { getDb } = require('../../lib/db');
const { sendJson } = require('../../lib/validate');

function generateHighlights(profile) {
  const highlights = [];
  const raw = profile.raw_feature_means || {};
  const audio = profile.audio_profile || {};
  const genres = profile.dominant_genres || {};
  const coverage = profile.coverage_pct || 0;

  // 1. Strongest audio characteristic
  const bounded = [
    { feature: 'energy',          pct: audio.energy_pct,          label: 'energy' },
    { feature: 'danceability',    pct: audio.danceability_pct,    label: 'danceability' },
    { feature: 'valence',         pct: audio.valence_pct,         label: 'positivity' },
    { feature: 'acousticness',    pct: audio.acousticness_pct,    label: 'acousticness' },
    { feature: 'instrumentalness', pct: audio.instrumentalness_pct, label: 'instrumentalness' },
    { feature: 'speechiness',     pct: audio.speechiness_pct,     label: 'speechiness' },
  ].filter((f) => f.pct != null && !isNaN(f.pct));

  if (bounded.length > 0) {
    const strongest = [...bounded].sort((a, b) => b.pct - a.pct)[0];
    const weakest   = [...bounded].sort((a, b) => a.pct - b.pct)[0];
    highlights.push({
      type: 'strongest_feature',
      text: `Your strongest audio characteristic is ${strongest.label} at ${strongest.pct.toFixed(1)}%.`,
      value: strongest.pct,
      feature: strongest.feature,
    });
    if (weakest.feature !== strongest.feature) {
      highlights.push({
        type: 'weakest_feature',
        text: `Your music tends to be low in ${weakest.label} (${weakest.pct.toFixed(1)}%).`,
        value: weakest.pct,
        feature: weakest.feature,
      });
    }
  }

  // 2. Most dominant genre
  const genreEntries = Object.entries(genres).sort(([, a], [, b]) => b - a);
  if (genreEntries.length > 0) {
    const [topGenre, topPct] = genreEntries[0];
    highlights.push({
      type: 'dominant_genre',
      text: `${topGenre.charAt(0).toUpperCase() + topGenre.slice(1)} makes up ${topPct.toFixed(1)}% of your matched catalog listening.`,
      value: topPct,
      genre: topGenre,
    });

    if (genreEntries.length >= 2) {
      const top2pct = (topPct + genreEntries[1][1]).toFixed(1);
      highlights.push({
        type: 'genre_concentration',
        text: `Your top 2 genres — ${genreEntries[0][0]} and ${genreEntries[1][0]} — account for ${top2pct}% of your taste.`,
        value: parseFloat(top2pct),
      });
    }
  }

  // 3. Tempo insight
  if (audio.avg_tempo_bpm) {
    const bpm = audio.avg_tempo_bpm;
    const tempoLabel = bpm >= 130 ? 'high-tempo (fast-paced)' : bpm >= 90 ? 'mid-tempo' : 'slow-tempo (relaxed)';
    highlights.push({
      type: 'tempo',
      text: `You gravitate toward ${tempoLabel} music — your average tempo is ${bpm.toFixed(0)} BPM.`,
      value: bpm,
    });
  }

  // 4. Coverage insight
  if (coverage > 0) {
    if (coverage >= 70) {
      highlights.push({
        type: 'coverage',
        text: `${coverage.toFixed(1)}% of your analyzed tracks matched the MusicLens 30K catalog — strong coverage.`,
        value: coverage,
      });
    } else {
      highlights.push({
        type: 'coverage',
        text: `${coverage.toFixed(1)}% of your analyzed tracks matched the catalog. Your taste includes many newer or less mainstream tracks.`,
        value: coverage,
      });
    }
  }

  // 5. Notable feature combination
  if (raw.energy != null && raw.valence != null) {
    const e = raw.energy;
    const v = raw.valence;
    let combo = null;
    if (e >= 0.7 && v >= 0.6)  combo = 'high-energy and positive — the hallmark of uplifting, danceable music.';
    else if (e >= 0.7 && v < 0.4) combo = 'high-energy but darker in mood — intense and powerful.';
    else if (e < 0.5 && v >= 0.6) combo = 'calm but uplifting — soothing and feel-good.';
    else if (e < 0.5 && v < 0.4)  combo = 'low-energy and melancholic — reflective and introspective.';
    if (combo) {
      highlights.push({
        type: 'energy_valence_combo',
        text: `Your tracks are ${combo}`,
        value: null,
      });
    }
  }

  return highlights.slice(0, 6);
}

module.exports = async function recap(req, res) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }

  if (!process.env.DATABASE_URL) {
    return sendJson(res, 500, { error: 'Server configuration error.' });
  }

  // ── Auth ───────────────────────────────────────────────────────────────
  let session;
  try {
    session = await validateSession(req);
  } catch (err) {
    console.error('[recap] session error:', err.message);
    return sendJson(res, 500, { error: 'Server error.' });
  }
  if (!session) return sendJson(res, 401, { error: 'Not authenticated.' });

  const sql = getDb();

  // ── Load profile ───────────────────────────────────────────────────────
  let profile;
  try {
    const rows = await sql`
      SELECT
        tracks_analyzed, tracks_matched, tracks_unmatched, tracks_ambiguous,
        coverage_pct, audio_profile, raw_feature_means,
        dominant_genres, top_artists, mood_distribution,
        archetype, archetype_tagline, archetype_desc,
        last_spotify_sync, last_refreshed_at
      FROM user_profile_data
      WHERE user_id = ${session.userId}
      LIMIT 1
    `;
    profile = rows[0] || null;
  } catch (err) {
    console.error('[recap] DB error:', err.message);
    return sendJson(res, 500, { error: 'Server error.' });
  }

  if (!profile) {
    return sendJson(res, 200, {
      hasRecap: false,
      message: 'No profile found. Connect Spotify and run your music analysis first.',
    });
  }

  // ── Build recap from persisted data ───────────────────────────────────
  const topGenres = Object.entries(profile.dominant_genres || {})
    .sort(([, a], [, b]) => b - a)
    .slice(0, 6)
    .map(([genre, pct]) => ({ genre, pct }));

  const recapData = {
    overview: {
      tracks_analyzed:   profile.tracks_analyzed,
      tracks_matched:    profile.tracks_matched,
      tracks_unmatched:  profile.tracks_unmatched,
      tracks_ambiguous:  profile.tracks_ambiguous,
      coverage_pct:      profile.coverage_pct,
      last_refreshed_at: profile.last_refreshed_at,
      last_spotify_sync: profile.last_spotify_sync,
    },
    audioProfile: profile.audio_profile || {},
    topGenres,
    topArtists:      (profile.top_artists    || []).slice(0, 10),
    moodDistribution: profile.mood_distribution || {},
    personality: {
      archetype: profile.archetype,
      tagline:   profile.archetype_tagline,
      desc:      profile.archetype_desc,
    },
    tasteHighlights: generateHighlights(profile),
  };

  return sendJson(res, 200, { hasRecap: true, recap: recapData });
};

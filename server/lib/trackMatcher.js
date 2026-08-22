/**
 * server/lib/trackMatcher.js
 * High-performance batch matching for Spotify tracks against the MusicLens catalog.
 *
 * Matching priority:
 *  1. Exact Spotify track ID  → status: 'matched'     (highest confidence)
 *  2. Artist match            → status: 'ambiguous'   (medium confidence)
 *  3. No match                → status: 'unmatched'   (not in catalog)
 */

'use strict';

const { getDb } = require('./db');

function normalize(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function matchTracks(spotifyTracks) {
  if (!spotifyTracks || spotifyTracks.length === 0) {
    return { results: [], stats: { total: 0, matched: 0, unmatched: 0, ambiguous: 0, coverage_pct: 0 } };
  }

  const sql = getDb();
  const allIds = [...new Set(spotifyTracks.map((t) => t.spotify_track_id).filter(Boolean))];

  // 1. Single batch query for exact track IDs
  let exactMatches = new Map();
  if (allIds.length > 0) {
    try {
      const rows = await sql`
        SELECT track_id
        FROM tracks
        WHERE track_id = ANY(${allIds})
      `;
      for (const row of rows) {
        exactMatches.set(row.track_id, row.track_id);
      }
    } catch (err) {
      console.warn('[trackMatcher] batch exact match failed:', err.message);
    }
  }

  // 2. Single batch query for unmatched track artists
  const needsArtistMatch = spotifyTracks.filter((t) => !exactMatches.has(t.spotify_track_id));
  const uniqueArtists = [...new Set(needsArtistMatch.map((t) => t.artist_name).filter(Boolean))];

  const artistMatches = new Map();
  if (uniqueArtists.length > 0) {
    try {
      const artistRows = await sql`
        SELECT a.artist_name, MIN(t.track_id) AS track_id
        FROM artists a
        JOIN tracks t ON t.artist_id = a.artist_id
        WHERE a.artist_name = ANY(${uniqueArtists})
        GROUP BY a.artist_name
      `;
      for (const r of artistRows) {
        artistMatches.set(r.artist_name.toLowerCase(), r.track_id);
      }
    } catch (err) {
      console.warn('[trackMatcher] batch artist match failed:', err.message);
    }
  }

  const results = spotifyTracks.map((t) => {
    const sid = t.spotify_track_id;
    const art = (t.artist_name || '').toLowerCase();

    if (exactMatches.has(sid)) {
      return {
        spotify_track_id: sid,
        catalog_track_id: exactMatches.get(sid),
        match_status: 'matched',
        track_name: t.track_name,
        artist_name: t.artist_name,
        source: t.source || 'top_tracks',
      };
    }

    if (art && artistMatches.has(art)) {
      return {
        spotify_track_id: sid,
        catalog_track_id: artistMatches.get(art),
        match_status: 'ambiguous',
        track_name: t.track_name,
        artist_name: t.artist_name,
        source: t.source || 'top_tracks',
      };
    }

    return {
      spotify_track_id: sid,
      catalog_track_id: null,
      match_status: 'unmatched',
      track_name: t.track_name,
      artist_name: t.artist_name,
      source: t.source || 'top_tracks',
    };
  });

  const total = results.length;
  const matched = results.filter((r) => r.match_status === 'matched').length;
  const ambiguous = results.filter((r) => r.match_status === 'ambiguous').length;
  const unmatched = results.filter((r) => r.match_status === 'unmatched').length;
  const coverage_pct = total > 0 ? Math.round(((matched + ambiguous) / total) * 100 * 10) / 10 : 0;

  return {
    results,
    stats: { total, matched, unmatched, ambiguous, coverage_pct },
  };
}

async function persistUserTracks(userId, matchResults, fetchedAt) {
  if (!matchResults || matchResults.length === 0) return;
  const sql = getDb();
  const now = fetchedAt || new Date();

  // Deduplicate before inserting to avoid redundant operations
  const seen = new Set();
  const uniqueResults = [];
  for (const r of matchResults) {
    const key = `${r.spotify_track_id}|${r.source || 'top_tracks'}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueResults.push(r);
    }
  }

  const CHUNK = 25;
  for (let i = 0; i < uniqueResults.length; i += CHUNK) {
    const chunk = uniqueResults.slice(i, i + CHUNK);
    await Promise.all(
      chunk.map((r) =>
        sql`
          INSERT INTO user_tracks (
            user_id, spotify_track_id, catalog_track_id,
            match_status, source, track_name, artist_name, spotify_fetched_at
          )
          VALUES (
            ${userId}, ${r.spotify_track_id}, ${r.catalog_track_id || null},
            ${r.match_status}, ${r.source || 'top_tracks'}, ${r.track_name || null}, ${r.artist_name || null},
            ${now}
          )
          ON CONFLICT (user_id, spotify_track_id, source) DO UPDATE SET
            catalog_track_id   = EXCLUDED.catalog_track_id,
            match_status       = EXCLUDED.match_status,
            track_name         = EXCLUDED.track_name,
            artist_name        = EXCLUDED.artist_name,
            spotify_fetched_at = EXCLUDED.spotify_fetched_at
        `.catch((err) => {
          console.warn('[trackMatcher] batch insert warning:', err.message);
        })
      )
    );
  }
}

module.exports = { matchTracks, persistUserTracks, normalize };


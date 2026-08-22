/**
 * server/lib/trackMatcher.js
 * Matches Spotify tracks against the MusicLens catalog (28,352 tracks in PostgreSQL).
 *
 * Matching priority (per spec):
 *  1. Exact Spotify track ID  → status: 'matched'     (highest confidence)
 *  2. Normalized name+artist  → status: 'ambiguous'   (medium confidence)
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

  let exactMatches = new Map();
  if (allIds.length > 0) {
    const rows = await sql`
      SELECT track_id
      FROM tracks
      WHERE track_id = ANY(${allIds})
    `;
    for (const row of rows) {
      exactMatches.set(row.track_id, row.track_id);
    }
  }

  const needsNameMatch = spotifyTracks.filter(
    (t) => !exactMatches.has(t.spotify_track_id)
  );

  const nameArtistPairs = [];
  const seenPairs = new Set();
  for (const t of needsNameMatch) {
    const key = `${normalize(t.track_name)}|||${normalize(t.artist_name)}`;
    if (!seenPairs.has(key)) {
      seenPairs.add(key);
      nameArtistPairs.push({ normName: normalize(t.track_name), normArtist: normalize(t.artist_name), key });
    }
  }

  const nameArtistMatches = new Map();

  if (nameArtistPairs.length > 0) {
    for (const { normName, normArtist, key } of nameArtistPairs) {
      if (!normName) {
        nameArtistMatches.set(key, { track_id: null, ambiguous: false });
        continue;
      }
      try {
        const rows = await sql`
          SELECT t.track_id
          FROM tracks t
          JOIN artists a ON a.artist_id = t.artist_id
          WHERE lower(regexp_replace(t.track_name, '[^\\w\\s]', ' ', 'g')) = ${normName}
            AND lower(regexp_replace(a.artist_name, '[^\\w\\s]', ' ', 'g')) = ${normArtist}
          LIMIT 2
        `;
        if (rows.length === 0) {
          nameArtistMatches.set(key, { track_id: null, ambiguous: false });
        } else if (rows.length === 1) {
          nameArtistMatches.set(key, { track_id: rows[0].track_id, ambiguous: true });
        } else {
          nameArtistMatches.set(key, { track_id: rows[0].track_id, ambiguous: true });
        }
      } catch {
        nameArtistMatches.set(key, { track_id: null, ambiguous: false });
      }
    }
  }

  const results = spotifyTracks.map((t) => {
    const sid = t.spotify_track_id;

    if (exactMatches.has(sid)) {
      return {
        spotify_track_id: sid,
        catalog_track_id: exactMatches.get(sid),
        match_status: 'matched',
        track_name: t.track_name,
        artist_name: t.artist_name,
        source: t.source,
      };
    }

    const key = `${normalize(t.track_name)}|||${normalize(t.artist_name)}`;
    const nameMatch = nameArtistMatches.get(key);
    if (nameMatch && nameMatch.track_id) {
      return {
        spotify_track_id: sid,
        catalog_track_id: nameMatch.track_id,
        match_status: 'ambiguous',
        track_name: t.track_name,
        artist_name: t.artist_name,
        source: t.source,
      };
    }

    return {
      spotify_track_id: sid,
      catalog_track_id: null,
      match_status: 'unmatched',
      track_name: t.track_name,
      artist_name: t.artist_name,
      source: t.source,
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
  if (matchResults.length === 0) return;
  const sql = getDb();
  const now = fetchedAt || new Date();

  const CHUNK = 50;
  for (let i = 0; i < matchResults.length; i += CHUNK) {
    const chunk = matchResults.slice(i, i + CHUNK);
    for (const r of chunk) {
      await sql`
        INSERT INTO user_tracks (
          user_id, spotify_track_id, catalog_track_id,
          match_status, source, track_name, artist_name, spotify_fetched_at
        )
        VALUES (
          ${userId}, ${r.spotify_track_id}, ${r.catalog_track_id},
          ${r.match_status}, ${r.source}, ${r.track_name || null}, ${r.artist_name || null},
          ${now}
        )
        ON CONFLICT (user_id, spotify_track_id, source) DO UPDATE SET
          catalog_track_id   = EXCLUDED.catalog_track_id,
          match_status       = EXCLUDED.match_status,
          track_name         = EXCLUDED.track_name,
          artist_name        = EXCLUDED.artist_name,
          spotify_fetched_at = EXCLUDED.spotify_fetched_at
      `;
    }
  }
}

module.exports = { matchTracks, persistUserTracks, normalize };

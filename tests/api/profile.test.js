/**
 * tests/api/profile.test.js
 * Unit and integration tests for Profile endpoints and ML profile generation.
 */

'use strict';

const httpMocks = require('node-mocks-http');

// ── Mock @neondatabase/serverless ─────────────────────────────────────────
const mockSql = jest.fn();
jest.mock('@neondatabase/serverless', () => ({
  neon: jest.fn(() => mockSql),
}));

// ── Mock global fetch ─────────────────────────────────────────────────────
global.fetch = jest.fn();

// ── Mock spotifyClient to control responses ──────────────────────────────
jest.mock('../../server/lib/spotifyClient', () => {
  const actual = jest.requireActual('../../server/lib/spotifyClient');
  return {
    ...actual,
    fetchAllUserMusic: jest.fn(),
  };
});

const refreshProfile = require('../../server/routes/profile/refresh');
const getProfile     = require('../../server/routes/profile/index');
const { fetchAllUserMusic, SpotifyAuthError, SpotifyRateLimitError, SpotifyApiError } = require('../../server/lib/spotifyClient');
const { determineArchetype, classifyGenre, deriveTrackFeatures, calculateProfile } = require('../../server/lib/profileCalculator');

// ── Helpers ────────────────────────────────────────────────────────────────
const USER_ID = 'user-uuid-001';
const FUTURE_EXPIRY = new Date(Date.now() + 86_400_000);

function makeReq(method, path = '/api/profile/refresh', opts = {}) {
  const { body = {}, cookies = { ml_session: 'a'.repeat(64) } } = opts;
  const cookieHeader = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
  return httpMocks.createRequest({
    method,
    url: path,
    body,
    headers: {
      'content-type': 'application/json',
      host: 'localhost',
      ...(cookieHeader && { cookie: cookieHeader }),
    },
  });
}

function makeRes() {
  return httpMocks.createResponse();
}

function stubValidSession() {
  mockSql
    .mockResolvedValueOnce([{ id: 'sess-1', user_id: USER_ID, expires_at: FUTURE_EXPIRY }]) // session lookup
    .mockResolvedValueOnce([{ id: USER_ID }]); // user exists
}

function setEnv() {
  process.env.DATABASE_URL          = 'postgresql://test:test@localhost/test';
  process.env.SPOTIFY_CLIENT_ID     = 'test_client_id';
  process.env.SPOTIFY_CLIENT_SECRET = 'test_client_secret';
  process.env.SPOTIFY_REDIRECT_URI  = 'http://localhost:3001/api/spotify/callback';
  process.env.TOKEN_ENCRYPTION_KEY  = '0'.repeat(64);
  process.env.APP_BASE_URL          = 'http://localhost:3001';
}

beforeEach(() => {
  mockSql.mockReset();
  jest.clearAllMocks();
  setEnv();
});

// ═══════════════════════════════════════════════════════════════════════════
// ML / Profile Calculator Unit Tests
// ═══════════════════════════════════════════════════════════════════════════
describe('ML Profile Calculator', () => {
  test('classifyGenre maps diverse Spotify genres to macro categories', () => {
    expect(classifyGenre('dance pop')).toBe('edm');
    expect(classifyGenre('melodic rap')).toBe('rap');
    expect(classifyGenre('trap latino')).toBe('latin');
    expect(classifyGenre('neo soul')).toBe('r&b');
    expect(classifyGenre('indie rock')).toBe('rock');
    expect(classifyGenre('k-pop')).toBe('pop');
    expect(classifyGenre('unknown-ambient-noise')).toBe(null);
  });

  test('determineArchetype correctly categorizes all 8 personalities', () => {
    // 1. Instrumental dreamer
    expect(determineArchetype({ instrumentalness: 0.5 }).archetype)
      .toBe('Atmospheric & Instrumental Dreamer');
    // 2. Acoustic & introspective
    expect(determineArchetype({ acousticness: 0.6, energy: 0.4 }).archetype)
      .toBe('Acoustic & Introspective Soul');
    // 3. High-energy party
    expect(determineArchetype({ energy: 0.8, danceability: 0.75 }).archetype)
      .toBe('High-Energy Party Enthusiast');
    // 4. Euphoric groove
    expect(determineArchetype({ valence: 0.7, danceability: 0.65, energy: 0.6, acousticness: 0.2 }).archetype)
      .toBe('Euphoric Groove Explorer');
    // 5. Nocturnal adrenaline
    expect(determineArchetype({ energy: 0.75, valence: 0.4, acousticness: 0.2 }).archetype)
      .toBe('Nocturnal Adrenaline Seeker');
    // 6. Lyrical flow
    expect(determineArchetype({ speechiness: 0.2, danceability: 0.65, energy: 0.6, acousticness: 0.2 }).archetype)
      .toBe('Lyrical Flow & Rhythm Connoisseur');
    // 7. Chill vibester
    expect(determineArchetype({ energy: 0.4, valence: 0.6, acousticness: 0.2 }).archetype)
      .toBe('Chill Vibester & Sunday Lounger');
    // 8. Default
    expect(determineArchetype({ energy: 0.6, valence: 0.5, danceability: 0.5, acousticness: 0.2 }).archetype)
      .toBe('Eclectic Sonic Connoisseur');
  });


  test('deriveTrackFeatures extracts catalog, artist, genre, and baseline features', () => {
    const spotifyTracks = [
      { spotify_track_id: 'track1', track_name: 'Hit Song', artist_name: 'Famous Artist', source: 'top_tracks' },
      { spotify_track_id: 'track2', track_name: 'Indie Song', artist_name: 'Indie Artist', source: 'top_tracks' },
      { spotify_track_id: 'track3', track_name: 'Unknown Song', artist_name: 'Unknown Artist', source: 'top_tracks' },
    ];

    const catalogTrackMap = new Map([
      ['track1', { track_id: 'track1', track_name: 'Hit Song', artist_name: 'Famous Artist', genre_name: 'pop', danceability: 0.8, energy: 0.9 }],
    ]);

    const catalogArtistMap = new Map([
      ['indie artist', { artist_name: 'indie artist', genre_name: 'rock', danceability: 0.6, energy: 0.7 }],
    ]);

    const { derivedTracks, stats } = deriveTrackFeatures(spotifyTracks, [], catalogTrackMap, catalogArtistMap);

    expect(derivedTracks).toHaveLength(3);
    expect(derivedTracks[0].match_status).toBe('matched');
    expect(derivedTracks[0].danceability).toBe(0.8);
    expect(derivedTracks[1].match_status).toBe('ambiguous');
    expect(derivedTracks[1].danceability).toBe(0.6);
    expect(derivedTracks[2].match_status).toBe('unmatched');
    expect(stats.total).toBe(3);
    expect(stats.matched).toBe(1);
    expect(stats.ambiguous).toBe(1);
    expect(stats.unmatched).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/profile/refresh
// ═══════════════════════════════════════════════════════════════════════════
describe('POST /api/profile/refresh', () => {
  test('405 — reject GET method', async () => {
    const req = makeReq('GET');
    const res = makeRes();
    await refreshProfile(req, res);
    expect(res.statusCode).toBe(405);
  });

  test('401 — unauthenticated request is rejected', async () => {
    const req = makeReq('POST', '/api/profile/refresh', { cookies: {} });
    const res = makeRes();
    await refreshProfile(req, res);
    expect(res.statusCode).toBe(401);
  });

  test('400 — Spotify not connected', async () => {
    stubValidSession();
    mockSql.mockResolvedValueOnce([]); // spotify_connections lookup returns empty

    const req = makeReq('POST');
    const res = makeRes();
    await refreshProfile(req, res);

    expect(res.statusCode).toBe(400);
    expect(res._getJSONData().error).toMatch(/spotify is not connected/i);
  });

  test('200 — empty Spotify listening data', async () => {
    stubValidSession();
    mockSql.mockResolvedValueOnce([{ user_id: USER_ID }]); // spotify connection exists
    fetchAllUserMusic.mockResolvedValueOnce({ tracks: [], topArtists: [] });

    const req = makeReq('POST');
    const res = makeRes();
    await refreshProfile(req, res);

    expect(res.statusCode).toBe(200);
    const data = res._getJSONData();
    expect(data.hasProfile).toBe(false);
    expect(data.stats.total).toBe(0);
  });

  test('200 — successful profile refresh with full ML taste profile', async () => {
    stubValidSession();
    mockSql.mockResolvedValueOnce([{ user_id: USER_ID }]); // spotify connection exists

    fetchAllUserMusic.mockResolvedValueOnce({
      tracks: [
        { spotify_track_id: 'sp_1', track_name: 'Summer Vibes', artist_name: 'Calvin Harris', source: 'top_tracks' },
        { spotify_track_id: 'sp_2', track_name: 'One Dance', artist_name: 'Drake', source: 'recently_played' },
        { spotify_track_id: 'sp_3', track_name: 'Blinding Lights', artist_name: 'The Weeknd', source: 'liked_songs' },
      ],
      topArtists: [
        { spotify_artist_id: 'art_1', artist_name: 'Drake', genres: ['canadian hip hop', 'rap', 'pop rap'], popularity: 95 },
        { spotify_artist_id: 'art_2', artist_name: 'Calvin Harris', genres: ['edm', 'dance pop', 'electro house'], popularity: 88 },
      ],
    });

    // Mock catalog track lookup (track_feature_vectors)
    mockSql.mockResolvedValueOnce([
      {
        track_id: 'sp_1',
        track_name: 'Summer Vibes',
        artist_name: 'Calvin Harris',
        genre_name: 'edm',
        danceability: 0.78,
        energy: 0.85,
        loudness: -4.5,
        speechiness: 0.06,
        acousticness: 0.05,
        instrumentalness: 0.12,
        liveness: 0.18,
        valence: 0.72,
        tempo: 128.0,
      },
    ]);

    // Mock artist_stats lookup for unmatched artists
    mockSql.mockResolvedValueOnce([
      {
        artist_name: 'drake',
        genre_name: 'rap',
        danceability: 0.75,
        energy: 0.62,
        valence: 0.48,
      },
    ]);

    // Mock user_profile_data upsert
    mockSql.mockResolvedValueOnce([{ user_id: USER_ID }]);
    // Mock user_tracks batch insert
    mockSql.mockResolvedValue([]);

    const req = makeReq('POST');
    const res = makeRes();
    await refreshProfile(req, res);

    expect(res.statusCode).toBe(200);
    const data = res._getJSONData();

    expect(data.hasProfile).toBe(true);
    expect(data.profile).toBeDefined();
    expect(data.profile.tracks_analyzed).toBe(3);
    expect(data.profile.audio_profile).toBeDefined();
    expect(data.profile.audio_profile.energy_pct).toBeGreaterThan(0);
    expect(data.profile.audio_profile.danceability_pct).toBeGreaterThan(0);
    expect(data.profile.preference_vector).toHaveLength(9);
    expect(data.profile.dominant_genres).toBeDefined();
    expect(data.profile.top_artists.length).toBeGreaterThan(0);
    expect(data.profile.mood_distribution).toBeDefined();
    expect(data.profile.archetype).toBeDefined();
    expect(data.profile.archetype_tagline).toBeDefined();
    expect(data.profile.archetype_desc).toBeDefined();
    expect(data.stats).toBeDefined();
    expect(data.syncedAt).toBeDefined();
  });

  test('401 — Spotify authentication revoked error', async () => {
    stubValidSession();
    mockSql.mockResolvedValueOnce([{ user_id: USER_ID }]);
    fetchAllUserMusic.mockRejectedValueOnce(new SpotifyAuthError('Spotify token revoked.'));

    const req = makeReq('POST');
    const res = makeRes();
    await refreshProfile(req, res);

    expect(res.statusCode).toBe(401);
    expect(res._getJSONData().error).toMatch(/spotify token revoked/i);
  });

  test('429 — Spotify rate limit error', async () => {
    stubValidSession();
    mockSql.mockResolvedValueOnce([{ user_id: USER_ID }]);
    fetchAllUserMusic.mockRejectedValueOnce(new SpotifyRateLimitError('Spotify rate limit hit. Retry after 30s.'));

    const req = makeReq('POST');
    const res = makeRes();
    await refreshProfile(req, res);

    expect(res.statusCode).toBe(429);
    expect(res._getJSONData().error).toMatch(/rate limit/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/profile
// ═══════════════════════════════════════════════════════════════════════════
describe('GET /api/profile', () => {
  test('401 — unauthenticated request rejected', async () => {
    const req = makeReq('GET', '/api/profile', { cookies: {} });
    const res = makeRes();
    await getProfile(req, res);
    expect(res.statusCode).toBe(401);
  });

  test('200 — returns persisted profile', async () => {
    stubValidSession();
    // user_profile_data + spotify_connections + likedCount
    mockSql
      .mockResolvedValueOnce([{ user_id: USER_ID, archetype: 'Euphoric Groove Explorer', coverage_pct: 80 }])
      .mockResolvedValueOnce([{ display_name: 'TestUser' }])
      .mockResolvedValueOnce([{ cnt: '5' }]);

    const req = makeReq('GET', '/api/profile');
    const res = makeRes();
    await getProfile(req, res);

    expect(res.statusCode).toBe(200);
    const data = res._getJSONData();
    expect(data.hasProfile).toBe(true);
    expect(data.spotifyConnected).toBe(true);
    expect(data.spotifyDisplayName).toBe('TestUser');
    expect(data.likedTracksCount).toBe(5);
    expect(data.profile.archetype).toBe('Euphoric Groove Explorer');
  });
});

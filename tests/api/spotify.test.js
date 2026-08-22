/**
 * tests/api/spotify.test.js
 * Unit tests for Spotify OAuth endpoints.
 * All external calls (Spotify API, DB) are mocked.
 * No real Spotify account or network access required.
 *
 * Coverage:
 *  - GET  /api/spotify/connect    (auth guard, state generation, redirect)
 *  - GET  /api/spotify/callback   (state validation, error param, token exchange, /me, upsert)
 *  - GET  /api/spotify/status     (connected/disconnected, auth guard)
 *  - POST /api/spotify/disconnect (delete row, best-effort revocation, auth guard, idempotent)
 */

'use strict';

const httpMocks = require('node-mocks-http');

// ── Mock @neondatabase/serverless ─────────────────────────────────────────
const mockSql = jest.fn();
jest.mock('@neondatabase/serverless', () => ({
  neon: jest.fn(() => mockSql),
}));

// ── Mock global fetch (used by callback and disconnect for Spotify API) ────
global.fetch = jest.fn();

// ── Import handlers after mocks ────────────────────────────────────────────
const connect    = require('../../server/routes/spotify/connect');
const callback   = require('../../server/routes/spotify/callback');
const status     = require('../../server/routes/spotify/status');
const disconnect = require('../../server/routes/spotify/disconnect');

// ── Helpers ────────────────────────────────────────────────────────────────
function makeReq(method, opts = {}) {
  const { body = {}, cookies = {}, query = '' } = opts;
  const cookieHeader = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
  return httpMocks.createRequest({
    method,
    url: `/api/spotify/${method === 'GET' ? 'callback' : 'endpoint'}${query ? '?' + query : ''}`,
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

const VALID_SESSION_COOKIE = { ml_session: 'a'.repeat(64) };
const FUTURE_EXPIRY = new Date(Date.now() + 86_400_000);
const USER_ID = 'user-uuid-001';

/** Stub a valid session: sessions row + user exists row */
function stubValidSession() {
  mockSql
    .mockResolvedValueOnce([{ id: 'sess-1', user_id: USER_ID, expires_at: FUTURE_EXPIRY }]) // sessions lookup
    .mockResolvedValueOnce([{ id: USER_ID }]); // user exists
}

function setEnv() {
  process.env.DATABASE_URL         = 'postgresql://test:test@localhost/test';
  process.env.SPOTIFY_CLIENT_ID    = 'test_client_id';
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
// GET /api/spotify/connect
// ═══════════════════════════════════════════════════════════════════════════
describe('GET /api/spotify/connect', () => {

  test('401 — unauthenticated request is rejected before any OAuth logic', async () => {
    const req = httpMocks.createRequest({ method: 'GET', url: '/api/spotify/connect', headers: { host: 'localhost' } });
    const res = makeRes();

    await connect(req, res);

    expect(res.statusCode).toBe(401);
    expect(res._getJSONData().error).toMatch(/not authenticated/i);
  });

  test('302 — authenticated request redirects to Spotify with all required params', async () => {
    stubValidSession();
    // DELETE old state + INSERT new state
    mockSql.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const req = httpMocks.createRequest({
      method: 'GET',
      url: '/api/spotify/connect',
      headers: { host: 'localhost', cookie: 'ml_session=' + 'a'.repeat(64) },
    });
    const res = makeRes();

    await connect(req, res);

    expect(res.statusCode).toBe(302);
    const location = res.getHeader('Location');
    expect(location).toContain('https://accounts.spotify.com/authorize');
    expect(location).toContain('client_id=test_client_id');
    expect(location).toContain('response_type=code');
    expect(location).toContain('redirect_uri=');
    expect(location).toContain('state=');
    expect(location).toContain('scope=');
    // Secret must NOT appear in redirect URL
    expect(location).not.toContain('test_client_secret');
  });

  test('redirect URL contains all 5 required scopes', async () => {
    stubValidSession();
    mockSql.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const req = httpMocks.createRequest({
      method: 'GET',
      url: '/api/spotify/connect',
      headers: { host: 'localhost', cookie: 'ml_session=' + 'a'.repeat(64) },
    });
    const res = makeRes();

    await connect(req, res);

    const location = decodeURIComponent(res.getHeader('Location'));
    expect(location).toContain('user-read-private');
    expect(location).toContain('user-read-email');
    expect(location).toContain('user-top-read');
    expect(location).toContain('user-read-recently-played');
    expect(location).toContain('user-library-read');
  });

  test('405 — POST method rejected', async () => {
    const req = httpMocks.createRequest({ method: 'POST', url: '/api/spotify/connect', headers: { host: 'localhost' } });
    const res = makeRes();

    await connect(req, res);

    expect(res.statusCode).toBe(405);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/spotify/callback
// ═══════════════════════════════════════════════════════════════════════════
describe('GET /api/spotify/callback', () => {

  function makeCallbackReq(queryString) {
    return httpMocks.createRequest({
      method: 'GET',
      url: `/api/spotify/callback?${queryString}`,
      headers: { host: 'localhost' },
    });
  }

  test('400 — missing state parameter', async () => {
    const req = makeCallbackReq('code=abc123');
    const res = makeRes();

    await callback(req, res);

    expect(res.statusCode).toBe(400);
    expect(res._getJSONData().error).toMatch(/state/i);
  });

  test('400 — state not found in DB (invalid/expired)', async () => {
    mockSql.mockResolvedValueOnce([]); // no matching state row

    const req = makeCallbackReq('code=abc123&state=deadbeef');
    const res = makeRes();

    await callback(req, res);

    expect(res.statusCode).toBe(400);
    expect(res._getJSONData().error).toMatch(/invalid or expired/i);
    // Spotify token endpoint must NOT be called
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('400 — state found but expired (expires_at in past)', async () => {
    const pastExpiry = new Date(Date.now() - 1000);
    mockSql
      .mockResolvedValueOnce([{ user_id: USER_ID, expires_at: pastExpiry }]) // state row
      .mockResolvedValueOnce([]); // DELETE expired state

    const req = makeCallbackReq('code=abc123&state=expiredstate');
    const res = makeRes();

    await callback(req, res);

    expect(res.statusCode).toBe(400);
    expect(res._getJSONData().error).toMatch(/expired/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('400 — error query param (user denied authorization)', async () => {
    const req = makeCallbackReq('error=access_denied&state=somestate');
    const res = makeRes();

    await callback(req, res);

    expect(res.statusCode).toBe(400);
    expect(res._getJSONData().error).toMatch(/denied/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('502 — Spotify token exchange fails', async () => {
    const validExpiry = new Date(Date.now() + 600_000);
    mockSql
      .mockResolvedValueOnce([{ user_id: USER_ID, expires_at: validExpiry }]) // state valid
      .mockResolvedValueOnce([]); // DELETE state

    // Token exchange returns non-200
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => 'invalid_grant',
    });

    const req = makeCallbackReq('code=badcode&state=validstate');
    const res = makeRes();

    await callback(req, res);

    expect(res.statusCode).toBe(502);
    expect(res._getJSONData().error).toMatch(/token exchange/i);
  });

  test('502 — Spotify /me call fails after successful token exchange', async () => {
    const validExpiry = new Date(Date.now() + 600_000);
    mockSql
      .mockResolvedValueOnce([{ user_id: USER_ID, expires_at: validExpiry }])
      .mockResolvedValueOnce([]); // DELETE state

    // Token exchange succeeds
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'at_test',
          refresh_token: 'rt_test',
          expires_in: 3600,
          scope: 'user-read-private',
        }),
      })
      // /me call fails
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

    const req = makeCallbackReq('code=goodcode&state=validstate');
    const res = makeRes();

    await callback(req, res);

    expect(res.statusCode).toBe(502);
    expect(res._getJSONData().error).toMatch(/profile/i);
  });

  test('409 — account_id already linked to a different MusicLens user', async () => {
    const validExpiry = new Date(Date.now() + 600_000);
    mockSql
      .mockResolvedValueOnce([{ user_id: USER_ID, expires_at: validExpiry }])
      .mockResolvedValueOnce([]) // DELETE state
      .mockResolvedValueOnce([{ user_id: 'different-user-uuid' }]); // conflict check

    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'at', refresh_token: 'rt', expires_in: 3600, scope: '' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ account_id: 'spotify-acc-123', id: 'sp-user', display_name: 'Other' }),
      });

    const req = makeCallbackReq('code=code&state=state');
    const res = makeRes();

    await callback(req, res);

    expect(res.statusCode).toBe(409);
    expect(res._getJSONData().error).toMatch(/already linked/i);
  });

  test('302 — full success redirects to /?spotify=connected (no tokens in URL)', async () => {
    const validExpiry = new Date(Date.now() + 600_000);
    mockSql
      .mockResolvedValueOnce([{ user_id: USER_ID, expires_at: validExpiry }])
      .mockResolvedValueOnce([]) // DELETE state
      .mockResolvedValueOnce([]) // conflict check — no existing row
      .mockResolvedValueOnce([]); // upsert

    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'at_secret', refresh_token: 'rt_secret', expires_in: 3600, scope: 'user-read-private' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ account_id: 'acc-new', id: 'sp-id', display_name: 'Test User' }),
      });

    const req = makeCallbackReq('code=goodcode&state=goodstate');
    const res = makeRes();

    await callback(req, res);

    expect(res.statusCode).toBe(302);
    const location = res.getHeader('Location');
    expect(location).toContain('/?spotify=connected');
    // Tokens must NEVER appear in the redirect URL
    expect(location).not.toContain('at_secret');
    expect(location).not.toContain('rt_secret');
    expect(location).not.toContain('access_token');
    expect(location).not.toContain('refresh_token');
  });

  test('tokens are encrypted before DB storage (never stored as plaintext)', async () => {
    const validExpiry = new Date(Date.now() + 600_000);
    mockSql
      .mockResolvedValueOnce([{ user_id: USER_ID, expires_at: validExpiry }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]); // upsert call captured

    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'plaintext_access', refresh_token: 'plaintext_refresh', expires_in: 3600, scope: '' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ account_id: 'acc-enc', id: 'sp-enc', display_name: 'Enc User' }),
      });

    const req = makeCallbackReq('code=code&state=state');
    const res = makeRes();

    await callback(req, res);

    // Inspect all DB call args for plaintext token values
    const allCallArgs = mockSql.mock.calls.flat().join(' ');
    expect(allCallArgs).not.toContain('plaintext_access');
    expect(allCallArgs).not.toContain('plaintext_refresh');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/spotify/status
// ═══════════════════════════════════════════════════════════════════════════
describe('GET /api/spotify/status', () => {

  test('401 — unauthenticated request', async () => {
    mockSql.mockResolvedValueOnce([]); // no session

    const req = httpMocks.createRequest({
      method: 'GET', url: '/api/spotify/status', headers: { host: 'localhost' },
    });
    const res = makeRes();

    await status(req, res);

    expect(res.statusCode).toBe(401);
  });

  test('200 — not connected returns connected=false, nulls', async () => {
    stubValidSession();
    mockSql.mockResolvedValueOnce([]); // no spotify_connections row

    const req = httpMocks.createRequest({
      method: 'GET',
      url: '/api/spotify/status',
      headers: { host: 'localhost', cookie: 'ml_session=' + 'a'.repeat(64) },
    });
    const res = makeRes();

    await status(req, res);

    expect(res.statusCode).toBe(200);
    const body = res._getJSONData();
    expect(body.connected).toBe(false);
    expect(body.displayName).toBeNull();
    expect(body.scope).toBeNull();
  });

  test('200 — connected returns displayName and scope, no tokens', async () => {
    stubValidSession();
    mockSql.mockResolvedValueOnce([{
      display_name: 'Divya',
      scope: 'user-read-private user-read-email',
    }]);

    const req = httpMocks.createRequest({
      method: 'GET',
      url: '/api/spotify/status',
      headers: { host: 'localhost', cookie: 'ml_session=' + 'a'.repeat(64) },
    });
    const res = makeRes();

    await status(req, res);

    expect(res.statusCode).toBe(200);
    const body = res._getJSONData();
    expect(body.connected).toBe(true);
    expect(body.displayName).toBe('Divya');
    expect(body.scope).toContain('user-read-private');
    // Must never expose tokens or account_id
    expect(body.access_token_encrypted).toBeUndefined();
    expect(body.refresh_token_encrypted).toBeUndefined();
    expect(body.account_id).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/spotify/disconnect
// ═══════════════════════════════════════════════════════════════════════════
describe('POST /api/spotify/disconnect', () => {

  test('401 — unauthenticated request', async () => {
    const req = httpMocks.createRequest({
      method: 'POST', url: '/api/spotify/disconnect', headers: { host: 'localhost' },
    });
    const res = makeRes();

    await disconnect(req, res);

    expect(res.statusCode).toBe(401);
    // DB delete must NOT be called
    const deleteCalls = mockSql.mock.calls.filter(
      (args) => args[0] && String(args[0]).includes('DELETE FROM spotify_connections')
    );
    expect(deleteCalls).toHaveLength(0);
  });

  test('200 — disconnects successfully when connection exists', async () => {
    stubValidSession();
    // Fetch encrypted refresh token
    mockSql.mockResolvedValueOnce([{ refresh_token_encrypted: 'iv:tag:ct' }]);
    // DELETE spotify_connections
    mockSql.mockResolvedValueOnce([]);

    // Best-effort revocation fetch (we allow it to succeed silently)
    global.fetch.mockResolvedValueOnce({ ok: true });

    const req = httpMocks.createRequest({
      method: 'POST',
      url: '/api/spotify/disconnect',
      headers: { host: 'localhost', cookie: 'ml_session=' + 'a'.repeat(64) },
    });
    const res = makeRes();

    await disconnect(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._getJSONData().ok).toBe(true);
  });

  test('200 — idempotent when no connection exists', async () => {
    stubValidSession();
    mockSql.mockResolvedValueOnce([]); // no refresh token row
    mockSql.mockResolvedValueOnce([]); // DELETE (affects 0 rows, still ok)

    const req = httpMocks.createRequest({
      method: 'POST',
      url: '/api/spotify/disconnect',
      headers: { host: 'localhost', cookie: 'ml_session=' + 'a'.repeat(64) },
    });
    const res = makeRes();

    await disconnect(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._getJSONData().ok).toBe(true);
  });

  test('200 — revocation failure does NOT block local deletion', async () => {
    stubValidSession();
    mockSql.mockResolvedValueOnce([{ refresh_token_encrypted: 'iv:tag:ct' }]);
    mockSql.mockResolvedValueOnce([]); // DELETE

    // Revocation fetch throws a network error
    global.fetch.mockRejectedValueOnce(new Error('Network error'));

    const req = httpMocks.createRequest({
      method: 'POST',
      url: '/api/spotify/disconnect',
      headers: { host: 'localhost', cookie: 'ml_session=' + 'a'.repeat(64) },
    });
    const res = makeRes();

    await disconnect(req, res);

    // Local deletion must still have succeeded
    expect(res.statusCode).toBe(200);
    expect(res._getJSONData().ok).toBe(true);
  });

  test('405 — GET method rejected', async () => {
    const req = httpMocks.createRequest({
      method: 'GET', url: '/api/spotify/disconnect', headers: { host: 'localhost' },
    });
    const res = makeRes();

    await disconnect(req, res);

    expect(res.statusCode).toBe(405);
  });
});

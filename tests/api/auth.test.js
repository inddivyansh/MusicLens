/**
 * tests/api/auth.test.js
 * Unit tests for MusicLens authentication endpoints.
 * All database calls are mocked — no real DB connection needed.
 *
 * Coverage:
 *  - POST /api/auth/register  (success, duplicate email, validation, missing fields)
 *  - POST /api/auth/login     (success, wrong password, unknown email, validation)
 *  - POST /api/auth/logout    (success with session, no cookie, idempotent)
 *  - GET  /api/auth/me        (authenticated, unauthenticated, spotifyConnected flag)
 */

'use strict';

const httpMocks = require('node-mocks-http');

// ── Mock @neondatabase/serverless before any require of our modules ────────
const mockSql = jest.fn();
// neon() returns a tagged-template function; we mock it to return mockSql
jest.mock('@neondatabase/serverless', () => ({
  neon: jest.fn(() => mockSql),
}));

// ── Mock bcryptjs ──────────────────────────────────────────────────────────
jest.mock('bcryptjs', () => ({
  hash:    jest.fn(async () => '$2b$12$hashedpassword'),
  compare: jest.fn(async () => true),
}));

// ── Import after mocks are set ─────────────────────────────────────────────
const register = require('../../server/routes/auth/register');
const login    = require('../../server/routes/auth/login');
const logout   = require('../../server/routes/auth/logout');
const me       = require('../../server/routes/auth/me');

// ── Helpers ────────────────────────────────────────────────────────────────
function makeReq(method, body = {}, cookies = {}) {
  const cookieHeader = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
  return httpMocks.createRequest({
    method,
    body,
    headers: { 'content-type': 'application/json', ...(cookieHeader && { cookie: cookieHeader }) },
  });
}

function makeRes() {
  return httpMocks.createResponse();
}

/** Set the required env vars for each test. */
function setEnv() {
  process.env.DATABASE_URL        = 'postgresql://test:test@localhost/test';
  process.env.TOKEN_ENCRYPTION_KEY = '0'.repeat(64); // 32 zero-bytes in hex
}

// ── Reset mocks between tests ─────────────────────────────────────────────
beforeEach(() => {
  jest.clearAllMocks();
  setEnv();
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/auth/register
// ═══════════════════════════════════════════════════════════════════════════
describe('POST /api/auth/register', () => {

  test('201 — successful registration creates user, profile, and session cookie', async () => {
    // First call: INSERT user+profile CTE → returns new user row
    // Second call: INSERT sessions
    mockSql
      .mockResolvedValueOnce([{ id: 'uuid-123', email: 'test@example.com' }])
      .mockResolvedValueOnce([]);

    const req = makeReq('POST', { email: 'Test@Example.com', password: 'securepass123' });
    const res = makeRes();

    await register(req, res);

    expect(res.statusCode).toBe(201);
    const body = res._getJSONData();
    expect(body.id).toBe('uuid-123');
    expect(body.email).toBe('test@example.com');
    expect(body.password_hash).toBeUndefined();
    expect(body.password).toBeUndefined();

    // Session cookie must be set
    const setCookie = res.getHeader('Set-Cookie');
    expect(setCookie).toBeDefined();
    expect(setCookie).toContain('ml_session=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
  });

  test('422 — missing email and password returns field list', async () => {
    const req = makeReq('POST', {});
    const res = makeRes();

    await register(req, res);

    expect(res.statusCode).toBe(422);
    const body = res._getJSONData();
    expect(body.error).toBeDefined();
    expect(body.fields).toContain('email');
    expect(body.fields).toContain('password');
  });

  test('422 — missing password only', async () => {
    const req = makeReq('POST', { email: 'a@b.com' });
    const res = makeRes();

    await register(req, res);

    expect(res.statusCode).toBe(422);
    expect(res._getJSONData().fields).toContain('password');
  });

  test('422 — invalid email format', async () => {
    const req = makeReq('POST', { email: 'notanemail', password: 'pass1234' });
    const res = makeRes();

    await register(req, res);

    expect(res.statusCode).toBe(422);
    expect(res._getJSONData().error).toMatch(/email/i);
  });

  test('422 — password too short (< 8 chars)', async () => {
    const req = makeReq('POST', { email: 'a@b.com', password: 'short' });
    const res = makeRes();

    await register(req, res);

    expect(res.statusCode).toBe(422);
    expect(res._getJSONData().error).toMatch(/password/i);
  });

  test('422 — password too long (> 72 chars)', async () => {
    const req = makeReq('POST', { email: 'a@b.com', password: 'a'.repeat(73) });
    const res = makeRes();

    await register(req, res);

    expect(res.statusCode).toBe(422);
    expect(res._getJSONData().error).toMatch(/password/i);
  });

  test('409 — duplicate email returns conflict error without creating rows', async () => {
    const pgError = new Error('duplicate key value violates unique constraint "users_email_key"');
    pgError.code = '23505';
    mockSql.mockRejectedValueOnce(pgError);

    const req = makeReq('POST', { email: 'exists@example.com', password: 'pass1234' });
    const res = makeRes();

    await register(req, res);

    expect(res.statusCode).toBe(409);
    expect(res._getJSONData().error).toMatch(/already exists/i);
  });

  test('405 — wrong HTTP method', async () => {
    const req = makeReq('GET', {});
    const res = makeRes();

    await register(req, res);

    expect(res.statusCode).toBe(405);
  });

  test('response body never contains password_hash', async () => {
    mockSql
      .mockResolvedValueOnce([{ id: 'uuid-456', email: 'safe@example.com' }])
      .mockResolvedValueOnce([]);

    const req = makeReq('POST', { email: 'safe@example.com', password: 'password99' });
    const res = makeRes();

    await register(req, res);

    const raw = res._getData();
    expect(raw).not.toContain('password_hash');
    expect(raw).not.toContain('password99');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/auth/login
// ═══════════════════════════════════════════════════════════════════════════
describe('POST /api/auth/login', () => {
  const bcrypt = require('bcryptjs');

  test('200 — successful login sets session cookie and returns id+email', async () => {
    mockSql
      .mockResolvedValueOnce([{ id: 'uuid-789', email: 'user@example.com', password_hash: '$2b$12$hash' }])
      .mockResolvedValueOnce([]);

    bcrypt.compare.mockResolvedValueOnce(true);

    const req = makeReq('POST', { email: 'user@example.com', password: 'correctpass' });
    const res = makeRes();

    await login(req, res);

    expect(res.statusCode).toBe(200);
    const body = res._getJSONData();
    expect(body.id).toBe('uuid-789');
    expect(body.email).toBe('user@example.com');
    expect(body.password_hash).toBeUndefined();

    const setCookie = res.getHeader('Set-Cookie');
    expect(setCookie).toContain('ml_session=');
    expect(setCookie).toContain('HttpOnly');
  });

  test('401 — unknown email returns generic error (does not reveal email existence)', async () => {
    mockSql.mockResolvedValueOnce([]); // no user found
    bcrypt.compare.mockResolvedValueOnce(false); // constant-time padding

    const req = makeReq('POST', { email: 'nobody@example.com', password: 'whatever' });
    const res = makeRes();

    await login(req, res);

    expect(res.statusCode).toBe(401);
    expect(res._getJSONData().error).toBe('Invalid email or password.');
    expect(res.getHeader('Set-Cookie')).toBeUndefined();
  });

  test('401 — wrong password returns same generic error', async () => {
    mockSql.mockResolvedValueOnce([{ id: 'u1', email: 'user@example.com', password_hash: '$2b$12$hash' }]);
    bcrypt.compare.mockResolvedValueOnce(false); // wrong password

    const req = makeReq('POST', { email: 'user@example.com', password: 'wrongpass' });
    const res = makeRes();

    await login(req, res);

    expect(res.statusCode).toBe(401);
    expect(res._getJSONData().error).toBe('Invalid email or password.');
  });

  test('422 — missing email', async () => {
    const req = makeReq('POST', { password: 'pass1234' });
    const res = makeRes();

    await login(req, res);

    expect(res.statusCode).toBe(422);
    expect(res._getJSONData().fields).toContain('email');
  });

  test('422 — missing password', async () => {
    const req = makeReq('POST', { email: 'a@b.com' });
    const res = makeRes();

    await login(req, res);

    expect(res.statusCode).toBe(422);
    expect(res._getJSONData().fields).toContain('password');
  });

  test('422 — empty string fields treated as missing', async () => {
    const req = makeReq('POST', { email: '', password: '' });
    const res = makeRes();

    await login(req, res);

    expect(res.statusCode).toBe(422);
  });

  test('response body never contains password_hash or raw token', async () => {
    mockSql
      .mockResolvedValueOnce([{ id: 'u1', email: 'user@example.com', password_hash: '$2b$12$secrethash' }])
      .mockResolvedValueOnce([]);
    bcrypt.compare.mockResolvedValueOnce(true);

    const req = makeReq('POST', { email: 'user@example.com', password: 'correctpass' });
    const res = makeRes();

    await login(req, res);

    const raw = res._getData();
    expect(raw).not.toContain('password_hash');
    expect(raw).not.toContain('secrethash');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/auth/logout
// ═══════════════════════════════════════════════════════════════════════════
describe('POST /api/auth/logout', () => {

  test('200 — valid session cookie is deleted and cookie cleared', async () => {
    mockSql.mockResolvedValueOnce([]); // DELETE sessions

    const req = makeReq('POST', {}, { ml_session: 'a'.repeat(64) });
    const res = makeRes();

    await logout(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._getJSONData().ok).toBe(true);

    const setCookie = res.getHeader('Set-Cookie');
    expect(setCookie).toContain('ml_session=');
    expect(setCookie).toContain('Max-Age=0');
  });

  test('200 — no session cookie still returns ok and clears cookie (idempotent)', async () => {
    const req = makeReq('POST', {});
    const res = makeRes();

    await logout(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._getJSONData().ok).toBe(true);
    // Clear cookie should still be set
    const setCookie = res.getHeader('Set-Cookie');
    expect(setCookie).toContain('Max-Age=0');
  });

  test('405 — GET method rejected', async () => {
    const req = makeReq('GET', {});
    const res = makeRes();

    await logout(req, res);

    expect(res.statusCode).toBe(405);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/auth/me
// ═══════════════════════════════════════════════════════════════════════════
describe('GET /api/auth/me', () => {

  test('200 — authenticated user gets id, email, spotifyConnected=false', async () => {
    // validateSession: sessions query → user exists query
    mockSql
      .mockResolvedValueOnce([{ id: 'sess-1', user_id: 'uuid-1', expires_at: new Date(Date.now() + 86400000) }])
      .mockResolvedValueOnce([{ id: 'uuid-1' }]) // user exists
      .mockResolvedValueOnce([{ id: 'uuid-1', email: 'me@example.com', spotify_connected: false }]);

    const req = makeReq('GET', {}, { ml_session: 'b'.repeat(64) });
    const res = makeRes();

    await me(req, res);

    expect(res.statusCode).toBe(200);
    const body = res._getJSONData();
    expect(body.email).toBe('me@example.com');
    expect(body.spotifyConnected).toBe(false);
    expect(body.password_hash).toBeUndefined();
  });

  test('200 — spotifyConnected is true when spotify_connections row exists', async () => {
    mockSql
      .mockResolvedValueOnce([{ id: 'sess-2', user_id: 'uuid-2', expires_at: new Date(Date.now() + 86400000) }])
      .mockResolvedValueOnce([{ id: 'uuid-2' }])
      .mockResolvedValueOnce([{ id: 'uuid-2', email: 'connected@example.com', spotify_connected: true }]);

    const req = makeReq('GET', {}, { ml_session: 'c'.repeat(64) });
    const res = makeRes();

    await me(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._getJSONData().spotifyConnected).toBe(true);
  });

  test('401 — no session cookie', async () => {
    const req = makeReq('GET', {});
    const res = makeRes();

    await me(req, res);

    expect(res.statusCode).toBe(401);
    expect(res._getJSONData().error).toBeDefined();
  });

  test('401 — session token not found in DB', async () => {
    mockSql.mockResolvedValueOnce([]); // no matching session row

    const req = makeReq('GET', {}, { ml_session: 'd'.repeat(64) });
    const res = makeRes();

    await me(req, res);

    expect(res.statusCode).toBe(401);
  });

  test('401 — expired session row triggers deletion and returns 401', async () => {
    const expiredAt = new Date(Date.now() - 1000); // 1 second in the past
    mockSql
      .mockResolvedValueOnce([{ id: 'sess-old', user_id: 'uuid-3', expires_at: expiredAt }])
      .mockResolvedValueOnce([]); // DELETE

    const req = makeReq('GET', {}, { ml_session: 'e'.repeat(64) });
    const res = makeRes();

    await me(req, res);

    expect(res.statusCode).toBe(401);
    // Ensure delete was called
    expect(mockSql).toHaveBeenCalledTimes(2);
  });

  test('405 — POST method rejected', async () => {
    const req = makeReq('POST', {});
    const res = makeRes();

    await me(req, res);

    expect(res.statusCode).toBe(405);
  });

  test('response body never contains password_hash or token', async () => {
    mockSql
      .mockResolvedValueOnce([{ id: 'sess-3', user_id: 'uuid-4', expires_at: new Date(Date.now() + 86400000) }])
      .mockResolvedValueOnce([{ id: 'uuid-4' }])
      .mockResolvedValueOnce([{ id: 'uuid-4', email: 'safe@example.com', spotify_connected: false }]);

    const req = makeReq('GET', {}, { ml_session: 'f'.repeat(64) });
    const res = makeRes();

    await me(req, res);

    const raw = res._getData();
    expect(raw).not.toContain('password_hash');
    expect(raw).not.toContain('token');
  });
});

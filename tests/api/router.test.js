/**
 * tests/api/router.test.js
 * Unit tests for server/router.js dispatcher and single entry-point api/[...path].js.
 */

'use strict';

const httpMocks = require('node-mocks-http');
const dispatch = require('../../server/router');
const handler = require('../../api/[...path]');

describe('Router & Dispatcher', () => {
  test('returns 404 for unknown route', async () => {
    const req = httpMocks.createRequest({
      method: 'GET',
      url: '/api/nonexistent/endpoint',
    });
    const res = httpMocks.createResponse();

    await dispatch(req, res);

    expect(res.statusCode).toBe(404);
    const data = res._getJSONData();
    expect(data.error).toContain('API route not found');
  });

  test('handles CORS OPTIONS preflight with 204', async () => {
    const req = httpMocks.createRequest({
      method: 'OPTIONS',
      url: '/api/auth/login',
    });
    const res = httpMocks.createResponse();

    await dispatch(req, res);

    expect(res.statusCode).toBe(204);
    expect(res.getHeader('Access-Control-Allow-Origin')).toBe('*');
  });

  test('normalizes pathname correctly from req.url with /api prefix', () => {
    const req = { url: '/api/auth/register?test=1' };
    expect(dispatch.getNormalizedPathname(req)).toBe('/auth/register');
  });

  test('normalizes pathname correctly from req.url without /api prefix', () => {
    const req = { url: '/auth/login' };
    expect(dispatch.getNormalizedPathname(req)).toBe('/auth/login');
  });

  test('normalizes pathname correctly from req.query.path array (Vercel style)', () => {
    const req = { query: { path: ['profile', 'like', '4iV5W9uYEdYUVa79Axb7Rh'] } };
    expect(dispatch.getNormalizedPathname(req)).toBe('/profile/like/4iV5W9uYEdYUVa79Axb7Rh');
  });

  test('normalizes dynamic route /api/blend/:id correctly', () => {
    const req = { url: '/api/blend/550e8400-e29b-41d4-a716-446655440000' };
    expect(dispatch.getNormalizedPathname(req)).toBe('/blend/550e8400-e29b-41d4-a716-446655440000');
  });

  test('api/[...path].js entry point invokes dispatch', async () => {
    const req = httpMocks.createRequest({
      method: 'GET',
      url: '/api/unknown',
    });
    const res = httpMocks.createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(404);
  });
});

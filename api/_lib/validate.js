/**
 * api/_lib/validate.js
 * Input validation helpers shared across auth and Spotify endpoints.
 */

'use strict';

/**
 * Validate an email address (RFC 5321 simplified).
 * local-part: 1–64 chars; domain: 1–255 chars; must contain @.
 * @param {string} email
 * @returns {boolean}
 */
function isValidEmail(email) {
  if (typeof email !== 'string') return false;
  const atIdx = email.lastIndexOf('@');
  if (atIdx < 1) return false;
  const local = email.slice(0, atIdx);
  const domain = email.slice(atIdx + 1);
  return local.length >= 1 && local.length <= 64 && domain.length >= 1 && domain.length <= 255;
}

/**
 * Validate a password (8–72 chars).
 * bcrypt silently truncates at 72 bytes; we enforce the max explicitly.
 * @param {string} password
 * @returns {boolean}
 */
function isValidPassword(password) {
  if (typeof password !== 'string') return false;
  return password.length >= 8 && password.length <= 72;
}

/**
 * Send a JSON response, handling both Vercel (res object) and raw Node ServerResponse.
 * @param {object} res
 * @param {number} status
 * @param {object} body
 * @param {object} [extraHeaders]
 */
function sendJson(res, status, body, extraHeaders = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  for (const [key, value] of Object.entries(extraHeaders)) {
    res.setHeader(key, value);
  }
  res.end(JSON.stringify(body));
}

/**
 * Safely parse JSON from a request body.
 * Works for both Vercel (body pre-parsed as string/object) and raw Node streams.
 * @param {object} req
 * @returns {Promise<object>}
 */
async function parseBody(req) {
  // Vercel already parses body into req.body
  if (req.body !== undefined) {
    if (typeof req.body === 'string') {
      try { return JSON.parse(req.body); } catch { return {}; }
    }
    return req.body || {};
  }

  // Raw Node: read stream
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(data)); } catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

module.exports = { isValidEmail, isValidPassword, sendJson, parseBody };

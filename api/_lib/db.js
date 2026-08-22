/**
 * api/_lib/db.js
 * Neon PostgreSQL client for Vercel Serverless Functions.
 * Uses @neondatabase/serverless (WebSocket-based) — suited for serverless cold starts.
 * DATABASE_URL is read from env; never exposed to the browser.
 */

'use strict';

const { neon } = require('@neondatabase/serverless');

let _sql = null;

/**
 * Returns a tagged-template SQL executor bound to DATABASE_URL.
 * Cached per function instance lifetime (warm invocations reuse the connection).
 */
function getDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is not set.');
  }
  if (!_sql) {
    // Strip Python SQLAlchemy dialect suffix (postgresql+psycopg2://) if present.
    // The Neon Node driver requires plain postgresql://
    const url = process.env.DATABASE_URL.replace(/^postgresql\+psycopg2:\/\//, 'postgresql://');
    _sql = neon(url);
  }
  return _sql;
}

module.exports = { getDb };

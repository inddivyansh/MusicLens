/**
 * sql/migrate.js
 * Applies sql/app_schema.sql to the Neon PostgreSQL database.
 *
 * Usage:
 *   node sql/migrate.js
 *
 * Requires DATABASE_URL in the environment (or a local .env file).
 * The music warehouse schema (sql/schema.sql) is managed separately by the
 * Python pipeline and is never modified here.
 *
 * Safe to run multiple times — all statements use CREATE TABLE IF NOT EXISTS
 * and CREATE INDEX IF NOT EXISTS.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { Pool } = require('@neondatabase/serverless');

// Load .env manually if present (not available in production Vercel)
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}

if (!process.env.DATABASE_URL) {
  console.error('Error: DATABASE_URL is not set. Add it to .env or export it before running migrate.');
  process.exit(1);
}

// Neon's Node driver requires postgresql:// (not postgresql+psycopg2://)
// Strip the Python SQLAlchemy dialect suffix if present.
const rawUrl = process.env.DATABASE_URL;
const nodeUrl = rawUrl.replace(/^postgresql\+psycopg2:\/\//, 'postgresql://');
if (rawUrl !== nodeUrl) {
  console.log('Note: Converted postgresql+psycopg2:// → postgresql:// for Node driver compatibility.');
}

const schemaPath = path.join(__dirname, 'app_schema.sql');
const schemaSql = fs.readFileSync(schemaPath, 'utf8');

async function migrate() {
  console.log('Connecting to database...');
  const pool = new Pool({ connectionString: nodeUrl });

  console.log(`Applying ${schemaPath}...`);
  const client = await pool.connect();
  try {
    // Execute the entire schema as a single multi-statement transaction
    await client.query(schemaSql);
    console.log('Migration complete. All application tables are up to date.');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();

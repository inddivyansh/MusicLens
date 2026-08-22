/**
 * api/_lib/crypto.js
 * Cryptographic utilities:
 *   - Opaque session token generation (32 random bytes → hex)
 *   - SHA-256 hashing of session tokens for DB storage
 *   - AES-256-GCM encrypt / decrypt for Spotify token storage at rest
 *
 * TOKEN_ENCRYPTION_KEY must be a 64-char hex string (32 bytes).
 * Format stored in DB:  <iv_hex>:<authTag_hex>:<ciphertext_hex>
 */

'use strict';

const crypto = require('crypto');

const SESSION_BYTES = 32;
const IV_BYTES = 12;       // GCM recommended
const KEY_BYTES = 32;      // AES-256
const ALGO = 'aes-256-gcm';

// ── Session token helpers ──────────────────────────────────────────────────

/**
 * Generate a cryptographically random session token (hex string, 64 chars).
 * The raw token goes into the httpOnly cookie; only its SHA-256 hash is stored.
 */
function generateSessionToken() {
  return crypto.randomBytes(SESSION_BYTES).toString('hex');
}

/**
 * Hash a raw session token with SHA-256.
 * @param {string} rawToken  hex string from cookie
 * @returns {string}         64-char hex SHA-256 digest
 */
function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken, 'hex').digest('hex');
}

// ── Spotify token encryption ───────────────────────────────────────────────

/**
 * Read and validate TOKEN_ENCRYPTION_KEY from environment.
 * Throws HTTP-500-friendly error if absent or wrong length.
 */
function getEncryptionKey() {
  const keyHex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!keyHex) {
    throw new Error('TOKEN_ENCRYPTION_KEY environment variable is not set.');
  }
  const keyBuf = Buffer.from(keyHex, 'hex');
  if (keyBuf.length !== KEY_BYTES) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY must be a ${KEY_BYTES * 2}-char hex string (${KEY_BYTES} bytes). Got ${keyBuf.length} bytes.`
    );
  }
  return keyBuf;
}

/**
 * Encrypt a plaintext string with AES-256-GCM.
 * @param {string} plaintext
 * @returns {string}  "<iv_hex>:<authTag_hex>:<ciphertext_hex>"
 */
function encrypt(plaintext) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt a string produced by encrypt().
 * @param {string} stored  "<iv_hex>:<authTag_hex>:<ciphertext_hex>"
 * @returns {string}  original plaintext
 */
function decrypt(stored) {
  const key = getEncryptionKey();
  const parts = stored.split(':');
  if (parts.length !== 3) {
    throw new Error('Encrypted token format is invalid — expected iv:tag:ciphertext.');
  }
  const [ivHex, tagHex, ctHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(tagHex, 'hex');
  const ciphertext = Buffer.from(ctHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  try {
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    throw new Error('Token decryption failed — key mismatch or corrupted data.');
  }
}

// ── OAuth state token ──────────────────────────────────────────────────────

/**
 * Generate a random OAuth CSRF state value (16 bytes → hex, 32 chars).
 */
function generateOAuthState() {
  return crypto.randomBytes(16).toString('hex');
}

module.exports = { generateSessionToken, hashToken, encrypt, decrypt, generateOAuthState };

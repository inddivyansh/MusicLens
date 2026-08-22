/**
 * api/blend/index.js
 *
 * POST /api/blend     — Create a new Friend Blend invitation.
 * GET  /api/blend      — List the authenticated user's blend sessions.
 *
 * Security:
 *   - Authenticated session required.
 *   - invite_token is crypto.randomBytes(32) hex — not guessable.
 *   - blend_sessions.expires_at defaults to 7 days.
 *   - No private profile data returned in the invite.
 */

'use strict';

const crypto = require('crypto');
const { validateSession } = require('../_lib/session');
const { getDb } = require('../_lib/db');
const { sendJson } = require('../_lib/validate');

module.exports = async function blendIndex(req, res) {
  if (!process.env.DATABASE_URL) {
    return sendJson(res, 500, { error: 'Server configuration error.' });
  }

  // ── Auth ───────────────────────────────────────────────────────────────
  let session;
  try {
    session = await validateSession(req);
  } catch (err) {
    console.error('[blend] session error:', err.message);
    return sendJson(res, 500, { error: 'Server error.' });
  }
  if (!session) return sendJson(res, 401, { error: 'Not authenticated.' });

  const sql = getDb();

  // ── POST: Create new blend ─────────────────────────────────────────────
  if (req.method === 'POST') {
    const inviteToken = crypto.randomBytes(32).toString('hex'); // 64-char hex
    try {
      const rows = await sql`
        INSERT INTO blend_sessions (creator_user_id, invite_token)
        VALUES (${session.userId}, ${inviteToken})
        RETURNING id, invite_token, status, created_at, expires_at
      `;
      const blend = rows[0];
      return sendJson(res, 201, {
        blendId: blend.id,
        inviteToken: blend.invite_token,
        status: blend.status,
        createdAt: blend.created_at,
        expiresAt: blend.expires_at,
      });
    } catch (err) {
      console.error('[blend] create error:', err.message);
      return sendJson(res, 500, { error: 'Could not create blend.' });
    }
  }

  // ── GET: List user's blends ─────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const blends = await sql`
        SELECT
          bs.id, bs.status, bs.created_at, bs.accepted_at, bs.completed_at,
          bs.expires_at, bs.invite_token,
          bs.creator_user_id, bs.participant_user_id,
          uc.email AS creator_email,
          up.email AS participant_email
        FROM blend_sessions bs
        LEFT JOIN users uc ON uc.id = bs.creator_user_id
        LEFT JOIN users up ON up.id = bs.participant_user_id
        WHERE bs.creator_user_id = ${session.userId}
           OR bs.participant_user_id = ${session.userId}
        ORDER BY bs.created_at DESC
        LIMIT 20
      `;

      const results = blends.map((b) => {
        const isCreator = b.creator_user_id === session.userId;
        return {
          blendId: b.id,
          status: b.status,
          createdAt: b.created_at,
          acceptedAt: b.accepted_at,
          completedAt: b.completed_at,
          expiresAt: b.expires_at,
          role: isCreator ? 'creator' : 'participant',
          // Only show the invite token to the creator when blend is still pending
          inviteToken: isCreator && b.status === 'pending' ? b.invite_token : undefined,
          // Show partner info (email only, no private data)
          partnerEmail: isCreator
            ? (b.participant_email || null)
            : (b.creator_email || null),
          hasResult: b.status === 'completed',
        };
      });

      return sendJson(res, 200, { blends: results });
    } catch (err) {
      console.error('[blend] list error:', err.message);
      return sendJson(res, 500, { error: 'Could not list blends.' });
    }
  }

  return sendJson(res, 405, { error: 'Method not allowed.' });
};

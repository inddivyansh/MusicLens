/**
 * server/routes/blend/join.js
 * POST /api/blend/join  { token: "..." }
 * A second authenticated user accepts a blend invitation.
 */

'use strict';

const { validateSession } = require('../../lib/session');
const { getDb } = require('../../lib/db');
const { sendJson, parseBody } = require('../../lib/validate');

module.exports = async function blendJoin(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }

  if (!process.env.DATABASE_URL) {
    return sendJson(res, 500, { error: 'Server configuration error.' });
  }

  // ── Auth ───────────────────────────────────────────────────────────────
  let session;
  try {
    session = await validateSession(req);
  } catch (err) {
    console.error('[blend/join] session error:', err.message);
    return sendJson(res, 500, { error: 'Server error.' });
  }
  if (!session) return sendJson(res, 401, { error: 'Not authenticated.' });

  // ── Parse body ─────────────────────────────────────────────────────────
  const body = await parseBody(req);
  const { token } = body;

  if (!token || typeof token !== 'string' || !/^[a-f0-9]{64}$/i.test(token)) {
    return sendJson(res, 400, { error: 'Invalid invite token.' });
  }

  const sql = getDb();

  try {
    const rows = await sql`
      SELECT id, creator_user_id, participant_user_id, status, expires_at
      FROM blend_sessions
      WHERE invite_token = ${token}
      LIMIT 1
    `;

    if (rows.length === 0) {
      return sendJson(res, 404, { error: 'Blend invitation not found.' });
    }

    const blend = rows[0];

    // ── Expiration check ────────────────────────────────────────────────
    if (new Date(blend.expires_at) < new Date()) {
      await sql`
        UPDATE blend_sessions SET status = 'expired'
        WHERE id = ${blend.id} AND status = 'pending'
      `.catch(() => {});
      return sendJson(res, 410, { error: 'This blend invitation has expired.' });
    }

    // ── Status check ────────────────────────────────────────────────────
    if (blend.status !== 'pending') {
      return sendJson(res, 409, { error: 'This blend has already been accepted or completed.' });
    }

    // ── Self-join check ─────────────────────────────────────────────────
    if (blend.creator_user_id === session.userId) {
      return sendJson(res, 400, { error: 'You cannot join your own blend invitation.' });
    }

    // ── Accept ──────────────────────────────────────────────────────────
    const updated = await sql`
      UPDATE blend_sessions
      SET participant_user_id = ${session.userId},
          status = 'accepted',
          accepted_at = NOW()
      WHERE id = ${blend.id}
        AND status = 'pending'
      RETURNING id, status, accepted_at
    `;

    if (updated.length === 0) {
      return sendJson(res, 409, { error: 'This blend was already accepted by someone else.' });
    }

    return sendJson(res, 200, {
      blendId: updated[0].id,
      status: updated[0].status,
      acceptedAt: updated[0].accepted_at,
    });
  } catch (err) {
    console.error('[blend/join] error:', err.message);
    return sendJson(res, 500, { error: 'Could not join blend.' });
  }
};

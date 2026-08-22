/**
 * server/routes/blend/detail.js
 * GET /api/blend/:id  — Get a blend session's status and results.
 */

'use strict';

const { validateSession } = require('../../lib/session');
const { getDb } = require('../../lib/db');
const { sendJson } = require('../../lib/validate');
const { calculateBlend } = require('../../lib/blender');

module.exports = async function blendDetail(req, res) {
  if (req.method !== 'GET') {
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
    console.error('[blend/id] session error:', err.message);
    return sendJson(res, 500, { error: 'Server error.' });
  }
  if (!session) return sendJson(res, 401, { error: 'Not authenticated.' });

  // ── Extract blend ID from req.query.id or URL path ─────────────────────
  let blendId = req.query?.id;
  if (!blendId && req.url) {
    const urlParts = req.url.split('?')[0].split('/');
    blendId = urlParts[urlParts.length - 1];
  }

  if (!blendId || blendId === 'blend') {
    return sendJson(res, 400, { error: 'Blend ID is required.' });
  }

  const sql = getDb();

  try {
    // ── Load blend session ─────────────────────────────────────────────
    const rows = await sql`
      SELECT
        bs.*,
        uc.email AS creator_email,
        up.email AS participant_email
      FROM blend_sessions bs
      LEFT JOIN users uc ON uc.id = bs.creator_user_id
      LEFT JOIN users up ON up.id = bs.participant_user_id
      WHERE bs.id = ${blendId}
      LIMIT 1
    `;

    if (rows.length === 0) {
      return sendJson(res, 404, { error: 'Blend not found.' });
    }

    const blend = rows[0];

    // ── Authorization: only participants ────────────────────────────────
    const isCreator = blend.creator_user_id === session.userId;
    const isParticipant = blend.participant_user_id === session.userId;
    if (!isCreator && !isParticipant) {
      return sendJson(res, 403, { error: 'You are not part of this blend.' });
    }

    // ── Expiration check ────────────────────────────────────────────────
    if (blend.status === 'pending' && new Date(blend.expires_at) < new Date()) {
      await sql`
        UPDATE blend_sessions SET status = 'expired'
        WHERE id = ${blendId} AND status = 'pending'
      `.catch(() => {});
      blend.status = 'expired';
    }

    // ── Base response (safe info only) ──────────────────────────────────
    const response = {
      blendId: blend.id,
      status: blend.status,
      role: isCreator ? 'creator' : 'participant',
      creatorEmail: blend.creator_email,
      participantEmail: blend.participant_email || null,
      createdAt: blend.created_at,
      acceptedAt: blend.accepted_at,
      completedAt: blend.completed_at,
      expiresAt: blend.expires_at,
      inviteToken: isCreator && blend.status === 'pending' ? blend.invite_token : undefined,
    };

    // ── If not yet accepted, return status only ─────────────────────────
    if (blend.status === 'pending' || blend.status === 'expired') {
      return sendJson(res, 200, response);
    }

    // ── Check if both users have profiles ───────────────────────────────
    const profiles = await sql`
      SELECT user_id, preference_vector, dominant_genres, top_artists,
             audio_profile, archetype
      FROM user_profile_data
      WHERE user_id IN (${blend.creator_user_id}, ${blend.participant_user_id})
    `;

    const profileA = profiles.find((p) => p.user_id === blend.creator_user_id);
    const profileB = profiles.find((p) => p.user_id === blend.participant_user_id);

    response.profilesReady = {
      creator: !!(profileA && profileA.preference_vector),
      participant: !!(profileB && profileB.preference_vector),
    };

    if (!response.profilesReady.creator || !response.profilesReady.participant) {
      response.message = 'Both users need a MusicLens profile before we can calculate your Blend. '
        + 'Connect Spotify and run your music analysis in the My Music tab.';
      return sendJson(res, 200, response);
    }

    // ── Return cached result if already computed ────────────────────────
    if (blend.blend_result && blend.status === 'completed') {
      response.result = blend.blend_result;
      return sendJson(res, 200, response);
    }

    // ── Calculate blend ─────────────────────────────────────────────────
    let result;
    try {
      result = await calculateBlend(
        profileA, profileB,
        blend.creator_user_id, blend.participant_user_id
      );
    } catch (err) {
      console.error('[blend/id] calculation error:', err.message);
      return sendJson(res, 500, { error: 'Blend calculation failed.' });
    }

    // ── Persist result ──────────────────────────────────────────────────
    const safeResult = { ...result };
    delete safeResult._vecA;
    delete safeResult._vecB;
    delete safeResult.preference_vector;

    try {
      await sql`
        UPDATE blend_sessions
        SET blend_result = ${JSON.stringify(safeResult)},
            status = 'completed',
            completed_at = NOW()
        WHERE id = ${blendId}
      `;
    } catch (err) {
      console.warn('[blend/id] persist failed:', err.message);
    }

    response.status = 'completed';
    response.result = safeResult;
    return sendJson(res, 200, response);
  } catch (err) {
    console.error('[blend/id] error:', err.message);
    return sendJson(res, 500, { error: 'Could not load blend.' });
  }
};

-- ============================================================
-- MusicLens — Application schema (accounts, sessions, Spotify)
-- ============================================================
-- Additive only. Never DROP these tables from sql/schema.sql.
-- Catalog reloads must leave this schema intact.
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           VARCHAR(255) NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT users_email_key UNIQUE (email),
    CONSTRAINT users_email_lower CHECK (email = lower(email))
);

COMMENT ON TABLE users IS 'MusicLens accounts. Passwords are stored as bcrypt hashes only.';

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

CREATE TABLE IF NOT EXISTS sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash      CHAR(64) NOT NULL,
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT sessions_token_hash_key UNIQUE (token_hash)
);

COMMENT ON TABLE sessions IS 'Opaque session tokens stored as SHA-256 hex hashes. Raw tokens live only in httpOnly cookies.';

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS user_profiles (
    user_id         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE user_profiles IS 'Placeholder personal-profile row. Listening snapshots are added in a later phase.';

CREATE TABLE IF NOT EXISTS spotify_connections (
    user_id                     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    account_id                  VARCHAR(128) NOT NULL,
    spotify_user_id             VARCHAR(128),
    display_name                TEXT,
    scope                       TEXT,
    refresh_token_encrypted     TEXT NOT NULL,
    access_token_encrypted      TEXT,
    access_token_expires_at     TIMESTAMPTZ,
    connected_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT spotify_connections_account_id_key UNIQUE (account_id)
);

COMMENT ON TABLE spotify_connections IS 'Server-side Spotify OAuth link. account_id is the immutable Spotify linking identifier. Tokens are encrypted at rest.';
COMMENT ON COLUMN spotify_connections.account_id IS 'Spotify GET /me account_id (immutable). Do not use spotify_user_id for account linking.';
COMMENT ON COLUMN spotify_connections.refresh_token_encrypted IS 'AES-256-GCM encrypted refresh token. Never returned to the browser.';

CREATE INDEX IF NOT EXISTS idx_spotify_connections_account_id ON spotify_connections (account_id);

-- ============================================================
-- OAuth CSRF State store (added Phase 1)
-- Short-lived; rows expire after 10 minutes and are deleted
-- on use or on a new connect attempt for the same user.
-- ============================================================

CREATE TABLE IF NOT EXISTS oauth_state (
    id          SERIAL       PRIMARY KEY,
    user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    state       VARCHAR(64)  NOT NULL,
    expires_at  TIMESTAMPTZ  NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT oauth_state_state_key UNIQUE (state)
);

COMMENT ON TABLE oauth_state IS 'Spotify OAuth CSRF state tokens. One active record per user, deleted on use.';

CREATE INDEX IF NOT EXISTS idx_oauth_state_user_id   ON oauth_state (user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_state_expires_at ON oauth_state (expires_at);

-- ============================================================
-- Phase 3: Spotify → MusicLens Profile tables
-- ============================================================

-- user_tracks: Spotify-sourced tracks mapped to MusicLens catalog.
-- Only identifiers and match metadata are stored — no audio content.
CREATE TABLE IF NOT EXISTS user_tracks (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    spotify_track_id    VARCHAR(62)  NOT NULL,
    catalog_track_id    VARCHAR(62)  REFERENCES tracks(track_id) ON DELETE SET NULL,
    match_status        VARCHAR(12)  NOT NULL CHECK (match_status IN ('matched','unmatched','ambiguous')),
    source              VARCHAR(20)  NOT NULL CHECK (source IN ('top_tracks','recently_played','liked_songs','manual')),
    track_name          TEXT,
    artist_name         TEXT,
    spotify_fetched_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT user_tracks_unique UNIQUE (user_id, spotify_track_id, source)
);

COMMENT ON TABLE  user_tracks IS 'Maps a user''s Spotify listening to the MusicLens catalog. match_status distinguishes confirmed, ambiguous, and unmatched tracks. Audio content is never stored.';
COMMENT ON COLUMN user_tracks.spotify_track_id  IS 'Spotify Base62 track ID — identifier only, no content.';
COMMENT ON COLUMN user_tracks.catalog_track_id  IS 'FK to tracks table when match_status = matched or ambiguous.';
COMMENT ON COLUMN user_tracks.match_status       IS 'matched=exact Spotify ID hit, ambiguous=name+artist match, unmatched=not in catalog.';
COMMENT ON COLUMN user_tracks.source             IS 'Which Spotify endpoint produced this track.';
COMMENT ON COLUMN user_tracks.track_name         IS 'Stored for display of unmatched tracks only.';
COMMENT ON COLUMN user_tracks.artist_name        IS 'Stored for display of unmatched tracks only.';

CREATE INDEX IF NOT EXISTS idx_user_tracks_user_id        ON user_tracks (user_id);
CREATE INDEX IF NOT EXISTS idx_user_tracks_match_status   ON user_tracks (user_id, match_status);
CREATE INDEX IF NOT EXISTS idx_user_tracks_catalog_id     ON user_tracks (catalog_track_id);

-- user_liked_tracks: in-app manual likes of MusicLens catalog tracks.
-- Source is always "manual" — not derived from Spotify saved tracks.
CREATE TABLE IF NOT EXISTS user_liked_tracks (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    catalog_track_id    VARCHAR(62)  NOT NULL REFERENCES tracks(track_id) ON DELETE CASCADE,
    liked_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT user_liked_tracks_unique UNIQUE (user_id, catalog_track_id)
);

COMMENT ON TABLE user_liked_tracks IS 'In-app manually liked MusicLens catalog tracks. Distinct from Spotify saved tracks.';

CREATE INDEX IF NOT EXISTS idx_user_liked_tracks_user_id ON user_liked_tracks (user_id);

-- user_profile_data: persisted MusicLens music profile derived from matched tracks.
-- JSONB columns store computed aggregates, not raw Spotify data.
-- Refreshed explicitly via POST /api/profile/refresh.
CREATE TABLE IF NOT EXISTS user_profile_data (
    user_id             UUID         PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    -- Coverage stats
    tracks_analyzed     INTEGER      NOT NULL DEFAULT 0,
    tracks_matched      INTEGER      NOT NULL DEFAULT 0,
    tracks_unmatched    INTEGER      NOT NULL DEFAULT 0,
    tracks_ambiguous    INTEGER      NOT NULL DEFAULT 0,
    coverage_pct        REAL         NOT NULL DEFAULT 0,
    -- MusicLens-computed profile (JSONB for extensibility)
    audio_profile       JSONB,       -- avg feature values + % breakdowns
    raw_feature_means   JSONB,       -- { danceability: 0.72, energy: 0.65, ... }
    preference_vector   JSONB,       -- 9-dim normalized vector for recommendations
    dominant_genres     JSONB,       -- { pop: 45.0, rock: 30.0, ... }
    dominant_subgenres  JSONB,
    top_artists         JSONB,       -- [{ artist, track_count }, ...]
    mood_distribution   JSONB,
    archetype           TEXT,
    archetype_tagline   TEXT,
    archetype_desc      TEXT,
    -- Metadata
    last_spotify_sync   TIMESTAMPTZ,
    last_refreshed_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE user_profile_data IS 'Persisted MusicLens profile computed from matched Spotify tracks. All columns are MusicLens-derived aggregates — no raw Spotify audio content.';
COMMENT ON COLUMN user_profile_data.preference_vector IS '9-dim mean feature vector for the recommendation engine (Prompt 4).';
COMMENT ON COLUMN user_profile_data.raw_feature_means IS 'Unscaled averages of the 9 RECOMMENDATION_FEATURES across all matched tracks.';

-- ============================================================
-- Phase 4: Recommendations + Recap tables
-- ============================================================

-- recommendation_history: records what was generated for a user.
-- Only written on explicit POST /api/recommendations/generate.
-- NOT written on every GET /api/recommendations.
CREATE TABLE IF NOT EXISTS recommendation_history (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    track_ids       JSONB        NOT NULL,   -- ordered array of returned catalog track_ids
    similarity_scores JSONB      NOT NULL,   -- parallel array of similarity scores [0,1]
    filters_used    JSONB,                   -- { genre, min_popularity, limit } snapshot
    generated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE recommendation_history IS 'Records recommendation sessions. Written only on explicit generation, not on every read.';

CREATE INDEX IF NOT EXISTS idx_rec_history_user_id ON recommendation_history (user_id);
CREATE INDEX IF NOT EXISTS idx_rec_history_generated ON recommendation_history (user_id, generated_at DESC);

-- ============================================================
-- Phase 5: Friend Blend tables
-- ============================================================

-- blend_sessions: two-user taste comparison sessions.
-- invite_token is crypto-random (32 bytes hex). blend_result stores the
-- computed compatibility analysis as JSONB (regenerated on demand).
CREATE TABLE IF NOT EXISTS blend_sessions (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    participant_user_id UUID         REFERENCES users(id) ON DELETE SET NULL,
    invite_token        VARCHAR(64)  NOT NULL,
    status              VARCHAR(20)  NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'accepted', 'completed', 'expired')),
    blend_result        JSONB,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    accepted_at         TIMESTAMPTZ,
    completed_at        TIMESTAMPTZ,
    expires_at          TIMESTAMPTZ  NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
    CONSTRAINT blend_sessions_invite_token_key UNIQUE (invite_token),
    CONSTRAINT blend_sessions_no_self CHECK (creator_user_id != participant_user_id)
);

COMMENT ON TABLE blend_sessions IS 'Friend Blend sessions. invite_token is crypto-random. blend_result stores the computed compatibility analysis as JSONB.';
COMMENT ON COLUMN blend_sessions.invite_token IS 'Crypto-random 32-byte hex token used in invite links. Not a user ID.';
COMMENT ON COLUMN blend_sessions.blend_result IS 'Computed blend analysis snapshot: score, feature compatibility, genre overlap, shared recs.';

CREATE INDEX IF NOT EXISTS idx_blend_sessions_creator     ON blend_sessions (creator_user_id);
CREATE INDEX IF NOT EXISTS idx_blend_sessions_participant ON blend_sessions (participant_user_id);
CREATE INDEX IF NOT EXISTS idx_blend_sessions_token       ON blend_sessions (invite_token);
CREATE INDEX IF NOT EXISTS idx_blend_sessions_expires     ON blend_sessions (expires_at);

# MusicLens — Development Guide

## Architecture Overview

```
Browser (React 18 + Vite)
      ↓ HTTPS only, credentials:include
Vercel Serverless Functions (/api/*)
      ↓ Neon WebSocket driver
Neon PostgreSQL
  ├── Music warehouse (tracks, audio_features, artists, ...)  ← read-only from app
  └── Application tables (users, sessions, spotify_connections, ...)
```

---

## Environment Variables

All secrets are **server-side only**. Never prefix with `VITE_`.

| Variable | Purpose | Required |
|---|---|---|
| `DATABASE_URL` | Neon PostgreSQL connection string | Always |
| `SPOTIFY_CLIENT_ID` | Spotify OAuth app client ID | Auth + Profile |
| `SPOTIFY_CLIENT_SECRET` | Spotify OAuth app client secret | Auth + Profile |
| `SPOTIFY_REDIRECT_URI` | OAuth callback URL (must match Spotify dashboard) | Auth + Profile |
| `TOKEN_ENCRYPTION_KEY` | 64-char hex string (32 bytes) for AES-256-GCM | Auth + Profile |
| `APP_BASE_URL` | Deployed app base URL (no trailing slash) | Auth |

**Generate `TOKEN_ENCRYPTION_KEY`:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Local `SPOTIFY_REDIRECT_URI`:** `http://localhost:3001/api/spotify/callback`

---

## Database Setup

Apply the application schema (safe to run multiple times):
```bash
node sql/migrate.js
```

The music warehouse (`sql/schema.sql`) is managed separately by the Python pipeline:
```bash
python pipeline/05_load_to_postgres.py
```

---

## Local Development

```bash
# Install root API dependencies
npm install

# Install frontend dependencies
npm install --prefix frontend

# Start Vercel dev server (serves /api/* + Vite frontend)
vercel dev

# Frontend-only dev (without API — for UI work)
cd frontend && npm run dev
```

The Vite dev server proxies `/api/*` to `localhost:3001` (Vercel dev).

---

## Spotify OAuth Setup

1. Create an app at https://developer.spotify.com/dashboard
2. Add Redirect URI: `http://localhost:3001/api/spotify/callback` (dev) and your production URL
3. Note the Client ID and Client Secret → add to `.env`
4. The app starts in **Development Mode** — add test users to the allowlist in the Spotify dashboard

---

## Spotify → MusicLens Data Flow

```
POST /api/profile/refresh
  │
  ├─ 1. Validate MusicLens session
  ├─ 2. Verify spotify_connections row exists
  ├─ 3. Fetch Spotify data (server-side only, tokens never leave server):
  │      - Top tracks: 3 time ranges × 50 = up to 150 unique tracks
  │      - Recently played: up to 50 tracks
  │      - Liked songs: up to 50 tracks
  │
  ├─ 4. Match each track against MusicLens catalog:
  │      Priority 1: exact Spotify track_id (Base62, batch SQL query)
  │        → status: "matched"
  │      Priority 2: normalized track_name + artist_name (PostgreSQL regex)
  │        → status: "ambiguous"
  │      No hit:
  │        → status: "unmatched" (stored for display, excluded from calculations)
  │
  ├─ 5. Persist to user_tracks (upsert per spotify_track_id + source)
  ├─ 6. Load audio features for matched + ambiguous catalog tracks
  │      (from track_feature_vectors materialized view, falls back to base tables)
  │
  ├─ 7. Calculate profile (JavaScript port of pipeline/utils/user_profile.py):
  │      - 9-feature means (danceability, energy, loudness, speechiness,
  │        acousticness, instrumentalness, liveness, valence, tempo)
  │      - Audio profile percentage breakdowns
  │      - Preference vector (9-dim, for Prompt 4 recommendations)
  │      - Dominant genres + mood quadrant distribution
  │      - Top 10 artists by track count
  │      - Personality archetype (8 types, same logic as Python)
  │
  └─ 8. Upsert user_profile_data, return profile
```

---

## Track Matching Approach

**Matching does NOT silently assume a match.** Every track has an explicit status.

| Status | How determined | Used in profile calc? |
|---|---|---|
| `matched` | Exact Spotify Base62 track_id found in `tracks` table | Yes |
| `ambiguous` | Normalized name+artist found in catalog (could be a cover/remix) | Yes |
| `unmatched` | Not in MusicLens 30K catalog (often post-2020 or obscure tracks) | No |

Coverage % = `(matched + ambiguous) / total × 100`

---

## Profile Calculation

Uses only `matched` and `ambiguous` catalog tracks. Audio features are pulled from the MusicLens warehouse — **not from the Spotify Audio Features API**. No model is trained on user data.

**Personality archetypes** (8 types, mirrors Python implementation exactly):
- Atmospheric & Instrumental Dreamer
- Acoustic & Introspective Soul
- High-Energy Party Enthusiast
- Euphoric Groove Explorer
- Nocturnal Adrenaline Seeker
- Lyrical Flow & Rhythm Connoisseur
- Chill Vibester & Sunday Lounger
- Eclectic Sonic Connoisseur

---

## API Endpoints

### Authentication
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/register` | No | Create account |
| POST | `/api/auth/login` | No | Sign in |
| POST | `/api/auth/logout` | Yes | Sign out |
| GET | `/api/auth/me` | Yes | Current user + spotifyConnected flag |

### Spotify OAuth
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/spotify/connect` | Yes | Initiate OAuth (redirects to Spotify) |
| GET | `/api/spotify/callback` | No | OAuth callback (server-side only) |
| GET | `/api/spotify/status` | Yes | Connection state + display name |
| POST | `/api/spotify/disconnect` | Yes | Remove connection + tokens |

### Profile
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/profile` | Yes | Persisted profile (no Spotify call) |
| POST | `/api/profile/refresh` | Yes | Full Spotify sync + recalculate |
| GET | `/api/profile/liked` | Yes | Manually liked catalog tracks |
| POST | `/api/profile/like/:trackId` | Yes | Like a catalog track |
| DELETE | `/api/profile/like/:trackId` | Yes | Unlike a catalog track |

### Recommendations
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/recommendations` | Yes | Server-side personalized recs from MusicLens catalog |

### Recap
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/recap` | Yes | MusicLens Recap from persisted profile (no Spotify call) |

### Friend Blend
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/blend` | Yes | Create blend invitation (crypto-secure invite token) |
| GET | `/api/blend` | Yes | List user's blend sessions |
| POST | `/api/blend/join` | Yes | Accept blend invitation (body: `{ token }`) |
| GET | `/api/blend/:id` | Yes | Get blend status + results (participants only) |

### Analytics (Dynamic)
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/analytics/overview` | No | Dataset overview stats (public, cached 5min) |
| GET | `/api/analytics/genres` | No | Genre distribution (public, cached 5min) |
| GET | `/api/analytics/audio` | No | Audio feature stats (public, cached 5min) |
| GET | `/api/analytics/artists` | No | Top artists (public, cached 5min) |

---

## Recommendation Engine

Cosine similarity between user's Z-score standardized preference vector and all catalog tracks in `track_feature_vectors`. Features:

```
[danceability, energy, loudness, speechiness, acousticness,
 instrumentalness, liveness, valence, tempo]
```

- Standardization uses catalog-derived means/stds (computed per request)
- Excludes already-liked tracks
- Returns per-feature explainability with natural-language narrative
- Blends manual likes with Spotify-derived profile (equal weight)

## Friend Blend

Compares two users' MusicLens profiles (never raw Spotify data):

**Blend Score (0–100):**
```
Per-feature compat = (1 − |normalized_A − normalized_B|) × 100
Blend Score = 70% × mean(feature compats) + 30% × genre overlap (cosine sim)
```

**Shared Recommendations:** Average of both preference vectors → same cosine similarity engine → excludes tracks liked by either user.

## Security Model

- `DATABASE_URL`, `SPOTIFY_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY` are server-side only
- Spotify access/refresh tokens are encrypted (AES-256-GCM) before DB storage
- Session tokens are stored as SHA-256 hashes; raw tokens only in `httpOnly` cookies
- Tokens are never returned in API responses or logged
- All `/api/profile/*` endpoints validate the session and scope all queries to `session.userId`
- Users cannot access each other's profiles — every query is `WHERE user_id = $session.userId`
- Spotify data is deleted when a user disconnects (`DELETE FROM spotify_connections`)

---

## Frontend Build

```bash
cd frontend
node node_modules/vite/bin/vite.js build
# or with npm (requires execution policy on Windows):
npm run build
```

Output: `frontend/dist/` — static files for Vercel CDN.

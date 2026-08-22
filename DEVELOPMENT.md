# MusicLens — Development Guide

## Architecture Overview

```
Browser (React 18 + Vite)
      ↓ HTTPS only, credentials:include
Vercel Single Catch-All Function (/api/[...path].js)
      ↓ Central Dispatcher (server/router.js)
Modular Internal Route Handlers (server/routes/*)
      ↓ Database & Cryptographic Libraries (server/lib/*)
Neon PostgreSQL
  ├── Music warehouse (tracks, audio_features, artists, ...)  ← read-only from app
  └── Application tables (users, sessions, spotify_connections, ...)
```

---

## Vercel Serverless Architecture

To remain well within the **Vercel Hobby plan limit of 12 Serverless Functions**, MusicLens consolidates all API routing into **exactly 1 Serverless Function**:

- **Entry Point**: `api/[...path].js` is the sole Vercel Serverless Function entry point deployed to the Vercel Edge/Serverless platform.
- **Routing & Dispatch**: `api/[...path].js` immediately invokes `server/router.js`, which inspects `req.method`, `req.url`, and path parameters to route incoming requests to the appropriate modular handler.
- **Internal Modular Structure**: All actual business logic, endpoints, and shared libraries live entirely outside the `api/` directory under `server/`:
  - `server/routes/auth/` — User registration, login, logout, and current session inspection.
  - `server/routes/spotify/` — Spotify OAuth connect, callback, connection status, and disconnect flows.
  - `server/routes/profile/` — Profile retrieval, Spotify data sync & feature calculation, and track likes.
  - `server/routes/recommendations/` — Personalized catalog recommendation engine.
  - `server/routes/recap/` — MusicLens Recap aggregation and factual taste highlights.
  - `server/routes/blend/` — Friend Blend creation, token join, and taste comparison.
  - `server/routes/analytics/` — Dataset aggregate statistics and audio distributions.
  - `server/lib/` — Reusable, database, session, encryption, recommender, and Spotify client modules.

This architecture ensures clean separation of concerns, high testability, zero route duplication, and reliable deployment on Vercel Hobby.

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

## Spotify → MusicLens Data Flow (Phase 4)

```
POST /api/profile/refresh
  │
  ├─ 1. Validate MusicLens session
  ├─ 2. Verify spotify_connections row exists
  │
  ├─ 3. Fetch Spotify data with pagination (tokens never leave server):
  │      Source A — top_tracks
  │        3 time ranges (short/medium/long_term) × 50 items each
  │        Deduped by spotify_track_id within source (first occurrence wins)
  │        Metadata preserved: position, time_range, popularity, all_artist_names
  │      Source B — recently_played  [cursor-based pagination]
  │        Default: 3 pages × 50 = up to 150 items
  │        Replays of same track aggregated → interaction_count++, latest played_at kept
  │        Metadata preserved: played_at (ISO timestamp), interaction_count
  │      Source C — liked_songs  [offset-based pagination]
  │        Default: 4 pages × 50 = up to 200 items
  │        Metadata preserved: added_at (ISO timestamp when saved)
  │      Source D — top_artists (50, medium_term) — for genre inference only
  │
  ├─ 4. Cross-source deduplication policy:
  │      A track can validly appear in multiple sources (top_tracks + liked_songs
  │      is common). Sources are kept SEPARATE — one (spotify_track_id × source)
  │      entry per source. The taste-aggregation layer handles cross-source
  │      weighting using liked > recent > long_term precedence so a track never
  │      gains extra weight simply from appearing in multiple lists.
  │
  ├─ 5. Entity resolution — 4-stage pipeline (server/lib/trackMatcher.js):
  │      All DB work is batched — zero N+1 queries.
  │
  │      Stage 1 — Exact Spotify / catalog track ID
  │        Single batched SELECT WHERE track_id = ANY(ids)
  │        → match_status: "matched", confidence: 1.00, method: "exact_id"
  │
  │      Stage 2 — Normalized exact name + primary artist
  │        normalize(): NFC, lowercase, collapse punctuation + whitespace
  │        Single batched SELECT with inline REGEXP_REPLACE normalization
  │        Multiple candidates → tiebreaking (album > duration > popularity > date)
  │        Single winner → "matched" (0.95), unresolved → "ambiguous" (0.90)
  │        method: "normalized_exact"
  │
  │      Stage 3 — Variant normalization (wider net)
  │        normalizeVariant() strips: feat/featuring, (with …), remix, live,
  │        remastered, radio edit, deluxe, extended mix, acoustic, album version,
  │        explicit, mono, stereo, bonus track — plus Unicode NFC and parentheses
  │        Same batched SELECT approach as Stage 2
  │        → "matched" (0.85) or "ambiguous" (0.75), method: "variant_normalized"
  │
  │      Stage 4 — Fuzzy trigram matching (artist-scoped)
  │        Dice coefficient on character trigrams — no external dependencies
  │        Candidates loaded with a single batched SELECT scoped to the
  │        unresolved artists; scored in-memory
  │        Threshold: 0.82 (no match accepted below this)
  │        Tied candidates → tiebreaking → "matched" or "ambiguous"
  │        method: "fuzzy_trigram"
  │
  │      Ambiguity handling:
  │        When multiple catalog candidates survive tiebreaking, result is
  │        "ambiguous" with all_candidates[] populated. These tracks are
  │        included in coverage % but flagged as unreliable — never silently
  │        promoted to "matched".
  │
  ├─ 6. Batch-load catalog audio features for matched + ambiguous tracks
  │      One SELECT WHERE track_id = ANY(catalog_ids) against track_feature_vectors
  │      Fallback: artist-average from artist_stats for unresolved catalog rows
  │
  ├─ 7. Load in-app manual likes (user_liked_tracks JOIN audio_features, LIMIT 200)
  │
  ├─ 8. Feature derivation + profile calculation:
  │      deriveTrackFeatures() builds enriched track objects with audio features
  │      calculateProfile() computes 9-feature means, audio profile breakdowns,
  │      source-aware taste representation, dominant genres, archetype (8 types)
  │
  ├─ 9. Upsert user_profile_data (single ON CONFLICT DO UPDATE query)
  │
  ├─ 10. Non-blocking bulk persist → user_tracks (single unnest() upsert)
  │       Includes: match_confidence, matching_method, played_at, added_at,
  │       interaction_count. On conflict: GREATEST(interaction_count),
  │       COALESCE for timestamps (never overwrites a known timestamp with NULL)
  │
  └─ 11. Return response (API-compatible with pre-Phase-4 shape + new keys)
```

---

## Spotify Ingestion — Pagination Details

| Source | API endpoint | Pagination | Default pages | Max items |
|---|---|---|---|---|
| `top_tracks` | `/me/top/tracks` | None (3 time ranges × limit=50) | — | ~150 unique |
| `recently_played` | `/me/player/recently-played` | Cursor-based (`before` param, Unix ms) | 3 | 150 |
| `liked_songs` | `/me/tracks` | Offset-based | 4 | 200 |
| `top_artists` | `/me/top/artists` | None | — | 50 |

Pagination stops early if:
- Spotify returns an empty `items` array
- The `next` URL is absent from the response
- The configured `max_pages` limit is reached

Rate-limit responses (HTTP 429) surface as `SpotifyRateLimitError` with the
`Retry-After` value from the response header. The caller receives HTTP 429 and
retries are left to the client — no silent back-off loop runs inside the serverless function.

---

## Track Matching Approach (Phase 4)

**Every track has an explicit match status. Nothing is silently assumed.**

| Status | Produced by | Confidence | Used in profile? | Reliable? |
|---|---|---|---|---|
| `matched` | Stages 1–4 (single winner) | 0.82–1.00 | Yes | Yes |
| `ambiguous` | Stages 2–4 (multiple candidates, unresolved) | 0.75–0.90 | Yes | No — flagged |
| `unmatched` | All stages failed | 0 | No | N/A |

**Coverage metrics returned in the API response:**

| Key | Meaning |
|---|---|
| `exact_id_matches` | Stage 1 hits |
| `normalized_matches` | Stage 2 hits (normalized_exact, matched) |
| `variant_matches` | Stage 3 hits (variant_normalized, matched) |
| `fuzzy_matches` | Stage 4 hits (fuzzy_trigram, matched) |
| `ambiguous` | Unresolved multi-candidate results across all stages |
| `unmatched` | No match found at any stage |
| `coverage_pct` | `(matched + ambiguous) / total × 100` |
| `reliable_pct` | `matched / total × 100` (excludes ambiguous) |

Do not conflate `coverage_pct` with accuracy. `reliable_pct` is the conservative figure.

**Variant normalization strips** (applied at Stage 3, in-memory, no extra DB query):
`feat`, `featuring`, `(with …)`, `remix`, `live`, `remastered`, `radio edit`,
`deluxe`, `extended mix`, `acoustic`, `album version`, `single version`,
`explicit`, `mono`, `stereo`, `bonus track` — plus Unicode NFC normalization
and parenthesized/bracketed suffix removal.

**Fuzzy matching scope:** Stage 4 only loads catalog tracks for the specific
artists that remain unresolved after Stages 1–3. It does not scan the full
28k-track catalog. Dice coefficient threshold = 0.82 — matches below this
are discarded as `unmatched` rather than returned as low-confidence results.

**Tiebreaking signals** (applied when multiple candidates share the same
normalized name + artist):
1. Exact album name match (Spotify metadata vs. catalog `track_album_name`)
2. Duration proximity — closest `duration_ms` within ±3000 ms
3. Highest `track_popularity` in catalog
4. Earliest `standard_release_date` (prefers original over remaster)

If all four signals are exhausted without a single winner, the result is
`ambiguous` with `all_candidates[]` populated for inspection.

---

## Persistence — user_tracks Table

`user_tracks` records the output of the entity-resolution pipeline for each user sync.
The bulk upsert uses PostgreSQL's `unnest()` to insert or update all rows in a
**single round-trip** — no N+1 patterns, no per-track INSERT loops.

**Conflict target:** `(user_id, spotify_track_id, source)`
Each source slot is independent — a track in both `top_tracks` and `liked_songs`
occupies two rows and carries different temporal/weighting metadata.

**Upsert behaviour on conflict:**

| Column | On conflict |
|---|---|
| `catalog_track_id` | Overwritten (latest match wins) |
| `match_status` | Overwritten |
| `match_confidence` | Overwritten |
| `matching_method` | Overwritten |
| `track_name`, `artist_name` | Overwritten |
| `played_at` | `COALESCE(new, existing)` — never overwrites a known timestamp with NULL |
| `added_at` | `COALESCE(new, existing)` |
| `interaction_count` | `GREATEST(new, existing)` — ratchets upward, never decreases |
| `spotify_fetched_at` | Overwritten with current sync time |

**Schema additions (Phase 4 — additive, safe to re-run):**

```sql
ALTER TABLE user_tracks
  ADD COLUMN IF NOT EXISTS match_confidence  REAL,        -- 0.0–1.00
  ADD COLUMN IF NOT EXISTS matching_method   VARCHAR(24), -- exact_id | normalized_exact | …
  ADD COLUMN IF NOT EXISTS played_at         TIMESTAMPTZ, -- recently_played source
  ADD COLUMN IF NOT EXISTS added_at          TIMESTAMPTZ, -- liked_songs source
  ADD COLUMN IF NOT EXISTS interaction_count INTEGER NOT NULL DEFAULT 1;
```

Apply with: `node sql/migrate.js`

---

## Profile Calculation (Phase 5)

The profile is computed in two passes inside `server/lib/profileCalculator.js` and `server/lib/tasteProfile.js`.

### Pass 1 — Baseline means (flat, unweighted)

A simple per-feature arithmetic mean across all derived tracks. Used as:
- Input for the personality archetype classifier (always uses the flat mean)
- Fallback `preference_vector` when the enhanced aggregation produces no valid output

### Pass 2 — Enhanced weighted aggregation

`buildTasteRepresentation()` in `tasteProfile.js` produces the production profile vector and is the source of truth for the recommendation engine. It uses the following pipeline:

**Step 1 — Source group assignment**

Each track is routed to exactly one of six groups based on its `source` and `time_range` fields:

| Spotify source | time_range | Internal group |
|---|---|---|
| `top_tracks` | `short_term` | `short_term` |
| `top_tracks` | `medium_term` | `medium_term` |
| `top_tracks` | `long_term` (or unset) | `long_term` |
| `recently_played` | — | `recent` |
| `liked_songs` | — | `liked` |
| `manual` (in-app likes) | — | `manual` |

**Step 2 — Cross-source deduplication**

A catalog track that resolves to the same `catalog_track_id` across multiple groups is assigned to exactly one group by this precedence (highest wins):

```
manual → liked → recent → short_term → medium_term → long_term
```

This prevents a track from gaining extra weight just because it appears in multiple Spotify endpoints. Tracks without a `catalog_track_id` (genre-inferred or default-baseline) are not deduplicated.

**Step 3 — Per-track composite weight**

For each track `i` in group `g`:
```
temporal_weight(i) = exp(-λ_g × age_days)   if timestamp available, else 1.0
frequency_weight(i) = min(interaction_count, frequency_cap)
match_weight(i)     = confidence             (from entity-resolution pipeline, 0.0–1.0)

composite_weight(i) = temporal_weight × frequency_weight × match_weight
```

`match_weight = 0` for genre-inferred and default-baseline tracks — they are excluded from the enhanced aggregation but still count toward the flat baseline means.

**Step 4 — Per-feature weighted mean within each group**

Each of the 9 audio features is aggregated independently using its own numerator/denominator accumulator. A corrupt or out-of-bounds value for one feature excludes that value from that feature's mean only — it does not discard the entire track or affect other features.

Physical bounds used for validation:

| Feature | Min | Max |
|---|---|---|
| danceability, energy, speechiness, acousticness, instrumentalness, liveness, valence | 0.0 | 1.0 |
| loudness | −60.0 dB | 5.0 dB |
| tempo | 30.0 BPM | 300.0 BPM |

**Step 5 — Source-weighted mean across groups**

```
profile_vector[i] = Σ_g (source_weight_g × group_vector_g[i]) / Σ_g source_weight_g
```

Only groups with at least one valid track and `source_weight > 0` contribute.

**Step 6 — Preference vector selection**

The final `preference_vector` stored in `user_profile_data` is:
- The enhanced `raw_vector` — when all 9 elements are finite (`preference_vector_source: "enhanced_weighted"`)
- The flat baseline means — when enhanced aggregation fails or returns null (`preference_vector_source: "baseline_mean"`)

The `audio_profile` percentage breakdowns shown in the UI are derived from `preference_vector`, so they reflect the weighted aggregation when available.

---

## Temporal Decay

Two decay rates are used — chosen based on the semantic meaning of each source:

| Source group | λ per day | Half-life | Rationale |
|---|---|---|---|
| `recent` (recently_played) | 0.08 | ≈ 8.7 days | Recent listening is strong short-term signal; last month should matter much less than last week |
| `liked` (liked_songs) | 0.005 | ≈ 139 days | Saves represent deliberate taste; a track saved 6 months ago still counts, but very recent saves score slightly higher |
| All others | — | No decay | `top_tracks` is already time-bucketed by Spotify's own time-range system; `manual` has no meaningful recency ordering |

Missing timestamps receive `temporal_weight = 1.0` — they are never discarded.

Formula:
```
temporal_weight = exp(−λ × age_days)
```

---

## Source Weights

Default values in `ml/artifacts/model_config.json`:

| Group | Default weight | Rationale |
|---|---|---|
| `long_term` | 1.0 | Enduring taste signal; Spotify's ~1-year window |
| `medium_term` | 0.8 | Moderately weighted; ~6-month window |
| `short_term` | 0.6 | Useful but noisier; ~4-week window |
| `recent` | 1.0 | Combined with temporal decay; reflects current mood |
| `liked` | 1.2 | Explicit user intent; higher than passive signals |
| `manual` | 1.2 | Strongest explicit signal; in-app deliberate action |

These are documented starting points, not evidence-based tuned values. They live in `model_config.json` so they can be tuned after offline evaluation without code changes. The aggregation re-reads the file on modification (file-mtime cache in `loadAggregationConfig()`).

---

## Frequency Weighting

`interaction_count` is the number of times a track was observed within the paginated recently_played batch. It scales the within-source contribution:

```
frequency_weight = min(interaction_count, frequency_cap)   [default cap: 10]
```

A track played 3 times in the last week contributes 3× more than a track heard once, but a track played 50 times contributes no more than one played 10 times. This prevents a single obsessively-replayed track from collapsing the profile into a single point.

---

## Profile Confidence / Quality Status

Based on the count of unique catalog-matched `catalog_track_id` values that fed into the enhanced aggregation (excludes genre-inferred and default-baseline tracks):

| Status | Condition | Interpretation |
|---|---|---|
| `insufficient_data` | < 3 matched tracks | Profile unreliable; recommend reconnecting or listening more |
| `limited` | 3–14 matched tracks | Usable but narrow; may not represent full taste range |
| `developing` | 15–39 matched tracks | Reasonable signal; profile will improve with more listening |
| `established` | ≥ 40 matched tracks | Sufficient data for reliable personalization |

This is a sample-size label. It does not measure recommendation quality.

The quality block appears at three levels in the API response:
- `profile.profile_quality` — inside the `profile` object
- `profile.taste_representation.quality` — inside the aggregation output
- `profile_quality` — surfaced at the top level of the response for easy frontend access

---

## Fallback Behaviour

| Condition | Fallback |
|---|---|
| `buildTasteRepresentation()` returns null (no valid groups) | `preference_vector` = flat baseline means; `taste_representation` = null; `preference_vector_source` = "baseline_mean" |
| ML artifacts missing (`preprocessing.json` absent) | Recommender uses baseline cosine mode; personalized mode unavailable |
| All features corrupt/out-of-bounds for a track | Track skipped in enhanced aggregation; still included in flat means |
| Single feature corrupt for a track | That feature excluded from that track's contribution; other features unaffected |
| Entity resolution fails entirely | All tracks treated as unmatched; profile built from genre-profile baseline values only |
| `model_config.json` missing or malformed | `DEFAULT_AGGREGATION` constants used (equal source weights, standard decay values) |

Fallbacks never fabricate values. An `insufficient_data` profile is returned as-is with `hasProfile: false` when zero derived tracks exist.

**Personality archetypes** (8 types, determined from the flat baseline means — unchanged from Python implementation):
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

## Recommendation Engine (Phase 6)

### Pipeline

```
GET /api/recommendations
  │
  ├─ 1. Load user_profile_data (preference_vector, taste_representation,
  │      dominant_genres, top_artists) — single query
  │
  ├─ 2. Load liked-track audio features for vector fallback — single query
  │
  ├─ 3. Resolve user vector — explicit cold-start fallback chain:
  │      a. enhanced_taste_representation (Phase 5 source-weighted aggregation)
  │         — used when profile quality ≥ min_quality_for_enhanced ('developing')
  │         — retrieval space: PCA 8-dim (canonical preprocessing.json artifact)
  │      b. preference_vector (Phase 5 fallback mean from profileCalculator)
  │         — retrieval space: standardized 9-feature audio space
  │      c. liked_track_average (mean of DB-loaded liked-track feature rows)
  │      d. catalog_popularity (non-personalized, clearly labelled in response)
  │
  ├─ 4. Build history exclusion set — two sequential queries:
  │      - user_liked_tracks (in-app likes)
  │      - user_tracks WHERE match_status IN ('matched','ambiguous')
  │          AND match_confidence >= 0.85
  │      Combined into a Set<catalog_track_id>; no per-track queries.
  │
  ├─ 5. Load catalog from track_feature_vectors (single query, optional
  │      genre + minPopularity filter applied in SQL)
  │
  ├─ 6. retrieveCandidates() — linear scan, cosine similarity in retrieval
  │      space, history exclusion applied, top candidate_limit (500) returned
  │
  ├─ 7. rankCandidates() — 6-signal weighted score (see Ranking Formula)
  │
  ├─ 8. rerankForDiversity() — MMR reranking with artist cap + genre penalty
  │
  └─ 9. buildRecommendations() — per-track payload + signal-driven explanation
```

### Ranking Formula

**Personalized mode** (enhanced taste_representation or preference_vector available):

```
final_score =
    w_audio × audio_score               (cosine in standardized 9-feature space, [0,1])
  + w_repr  × repr_score                (cosine in PCA 8-dim space, [0,1]; same as audio in baseline)
  + w_genre × genre_score               (smooth weighted sum — see Genre Affinity)
  + w_art   × artist_score              (1 if artist in user's top_artists, else 0)
  + w_pop   × popularity_score          (log-normalised Spotify popularity)
  + w_nov   × novelty_score             (1 − popularity_score)
```

Default weights from `ml/recommendation_config.json`:

| Signal | Weight | Notes |
|---|---|---|
| `audio_similarity` | 0.45 | Cosine in standardized audio space |
| `representation_similarity` | 0.25 | Cosine in PCA space (enhanced) or audio space (baseline) |
| `genre_affinity` | 0.10 | Smooth weighted sum — see below |
| `artist_affinity` | 0.04 | Binary preference signal |
| `popularity_prior` | 0.06 | Counters pure novelty bias |
| `novelty` | 0.10 | Surfaces less obvious tracks |

**These are documented starting values, not performance-tuned weights.** Tune them after running `python -m ml.evaluation.evaluate` and examining the comparison.json output.

**Baseline mode** (used when falling back to preference_vector, liked-average, or explicitly requested):

Uses `ranking.baseline_weights` from config — audio_similarity 0.80, genre 0.08, artist 0.04, popularity 0.02, novelty 0.06. No PCA representation_similarity component.

### Genre Affinity (smooth weighted sum)

Phase 6 replaces the previous binary/max-genre approach:

```
genre_score = clamp( Σ_g  profile_pct_g/100 × 1(track_genre = g) )
```

A track matching a genre that is 60 % of the user's profile scores 0.60; one matching only a 10 % genre scores 0.10. Clamped to [0, 1]. This reflects the actual strength of genre preference rather than a binary present/absent flag.

### Diversity Reranking (MMR)

```
MMR_score(i) = λ × relevance(i) − (1−λ) × max_sim_to_selected − genre_penalty × repeated_genres
```

| Parameter | Default | Config key |
|---|---|---|
| `mmr_lambda` | 0.72 | `diversity.mmr_lambda` |
| `max_per_artist` | 2 | `diversity.max_per_artist` |
| `genre_repeat_penalty` | 0.04 | `diversity.genre_repeat_penalty` |

λ = 1.0 is pure relevance; λ = 0.0 is pure diversity. 0.72 biases toward relevance while maintaining meaningful list variety.

### History Filtering

Two sequential queries (no N+1):
1. `SELECT catalog_track_id FROM user_liked_tracks WHERE user_id = ?`
2. `SELECT catalog_track_id FROM user_tracks WHERE user_id = ? AND match_status IN ('matched','ambiguous') AND match_confidence >= 0.85`

Combined into a Set. Tracks in this set are excluded from candidate retrieval. Configurable via `history_filtering` in `recommendation_config.json`:
- `exclude_liked_tracks` — toggle in-app likes exclusion
- `exclude_matched_tracks` — toggle Spotify-matched track exclusion
- `min_confidence_to_exclude` — only exclude user_tracks above this confidence (default 0.85; avoids over-filtering from weak fuzzy matches)
- `history_limit` — max rows loaded (default 2000)

### Cold-Start Fallback Chain

When no personalized vector exists, the response includes `recommender_mode: "cold_start"` and returns top catalog tracks by popularity. Every recommendation's explanation explicitly states it is non-personalized. The fallback chain and popularity thresholds are configurable in `cold_start` config block.

### Explanation Generation

Explanations are built from the actual signal values that drove the ranking. A signal is only mentioned if its value exceeds the configured threshold:

| Signal | Config threshold | Mention |
|---|---|---|
| Genre affinity | `genre_mention_threshold` (0.15) | "Aligns with your {genre} preference" |
| Artist affinity | `artist_mention_threshold` (0.50) | "From an artist in your listening history" |
| Novelty | `novelty_mention_threshold` (0.65) | "Less mainstream — surfaces a discovery" |
| Feature alignment | Always shown | Top-N features with smallest standardized delta |
| Diversity | Personalized mode only | MMR score, genre repeat count |

No explanation claims a signal contributed unless its value actually exceeded the threshold.

### Configuration

All tunable parameters live in `ml/recommendation_config.json`. Changes take effect on the next request (file-mtime cached). No restart required.

Key config sections:
- `retrieval` — candidate limit, representation mode, quality threshold
- `ranking.weights` — 6 signal weights for personalized mode
- `ranking.baseline_weights` — weights for baseline mode
- `diversity` — MMR λ, artist cap, genre penalty
- `history_filtering` — what to exclude and confidence threshold
- `cold_start` — fallback chain and popularity thresholds
- `explanation` — signal mention thresholds

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

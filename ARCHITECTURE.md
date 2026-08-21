# MusicLens — Architecture Document

## Overview

MusicLens is a data analytics and music recommendation platform that demonstrates production-quality data engineering using the Spotify 30,000 Songs dataset. The architecture prioritizes **free-tier deployment**, **offline-first analytics**, and **professional UI quality**.

---

## Architecture Pattern: Offline Pipeline + Static/Serverless Frontend

### Core Principle

> All expensive computation (data cleaning, EDA, feature engineering, model training) happens **offline** in a Python pipeline. The deployed application consumes **pre-computed artifacts** (JSON, database views) and performs only lightweight queries at runtime.

This eliminates the need for a continuously running Python server, keeping infrastructure costs at $0.

---

## System Components

### 1. Data Pipeline (Python, Local)

**Purpose**: Transform raw Spotify data into analytics-ready artifacts.

```
Raw CSV
  ↓ 01_download_data.py      — Fetch from Kaggle
  ↓ 02_clean_data.py          — Handle nulls, types, duplicates, validation
  ↓ 03_eda.py                 — Statistical analysis, distribution plots
  ↓ 04_feature_engineering.py  — Normalize features, create derived metrics
  ↓ 05_load_to_postgres.py    — Star schema load to Neon PostgreSQL
  ↓ 06_build_recommendations.py — Content-based similarity computation
  ↓ 07_export_analytics.py    — Export JSON artifacts for frontend
```

**Key Design Decisions**:
- Numbered scripts enforce execution order
- Each script is idempotent (safe to re-run)
- Config is centralized in `pipeline/config.py`
- All scripts share utilities from `pipeline/utils/`

### 2. Database (Neon PostgreSQL, Free Tier)

**Purpose**: Serve as the analytical warehouse and recommendation query engine.

**Schema Design**: Star schema optimized for analytical queries.

```
┌─────────────────┐     ┌───────────────────┐
│     tracks       │     │  audio_features    │
│─────────────────│     │───────────────────│
│ track_id (PK)   │────→│ track_id (PK, FK) │
│ track_name      │     │ danceability      │
│ track_artist    │     │ energy            │
│ track_popularity│     │ key               │
│ duration_ms     │     │ loudness          │
│ album_id        │     │ mode              │
│ album_name      │     │ speechiness       │
│ album_release_  │     │ acousticness      │
│   date          │     │ instrumentalness  │
└────────┬────────┘     │ liveness          │
         │              │ valence           │
         │              │ tempo             │
         │              └───────────────────┘
         │
┌────────▼────────┐
│ playlist_tracks  │
│─────────────────│
│ id (PK)         │
│ track_id (FK)   │
│ playlist_id     │
│ playlist_name   │
│ playlist_genre  │
│ playlist_       │
│   subgenre      │
└─────────────────┘
```

**Why Star Schema**:
- A single track can appear in multiple playlists → normalized to avoid duplication
- Audio features are 1:1 with tracks → separate table keeps tracks table lean
- Optimized for GROUP BY / aggregate queries common in analytics
- Power BI connects naturally to this structure

**Neon-Specific Considerations**:
- Connection via serverless driver (`@neondatabase/serverless`) from Vercel
- Connection pooling handled by Neon's built-in proxy
- Auto-suspend after 5 min idle → ~1-2s cold start on first query
- 0.5GB storage limit → our dataset uses ~15MB (well within limit)

### 3. Frontend (Next.js on Vercel)

**Purpose**: Professional analytics dashboard with interactive exploration and recommendations.

**Rendering Strategy**:
- **Static pages** for pre-computed analytics (built at deploy time from JSON)
- **Server-side API routes** for dynamic queries (song search, recommendations)
- **Client-side interactivity** for chart filtering and exploration

**API Routes**:
| Route | Method | Purpose |
|---|---|---|
| `/api/songs` | GET | Search/filter songs from PostgreSQL |
| `/api/songs/[id]` | GET | Get single song with full details |
| `/api/recommend` | POST | Content-based recommendations |
| `/api/analytics/summary` | GET | Aggregated statistics |

### 4. Power BI Integration

**Purpose**: Enable Power BI Desktop connection for custom business intelligence.

**Connection Methods**:
1. **Direct PostgreSQL connection** — Power BI Desktop → Neon PostgreSQL
2. **CSV/Parquet export** — Pre-exported clean data files
3. **SQL views** — Pre-built analytical views optimized for BI tools

---

## Data Flow

```
                    OFFLINE (Local)                           ONLINE (Cloud)
    ┌─────────────────────────────────────┐    ┌─────────────────────────────────┐
    │                                     │    │                                 │
    │  Kaggle CSV                         │    │  Vercel (Next.js)               │
    │     ↓                               │    │     ↕                           │
    │  Python Pipeline                    │    │  Pre-computed JSON              │
    │     ↓              ↓                │    │  (static analytics)             │
    │  JSON Artifacts   Neon PG ─────────────→│                                 │
    │     ↓              (load data)      │    │  API Routes ←→ Neon PG          │
    │  git commit        │                │    │  (dynamic queries)              │
    │  to frontend/      │                │    │                                 │
    │  public/           │                │    │  User Browser                   │
    │                    │                │    │  (interactive charts)           │
    └────────────────────│────────────────┘    └─────────────────────────────────┘
                         │
                    Power BI Desktop
                    (direct PG connection)
```

---

## Security

- All credentials stored in environment variables
- `.env` never committed (enforced by `.gitignore`)
- Neon connections require SSL (`?sslmode=require`)
- Vercel environment variables configured via dashboard
- No API keys exposed to client-side code
- Database user has minimal required permissions

---

## Scalability Considerations

While designed for a demo/portfolio context, the architecture scales naturally:

| Concern | Current (Demo) | Scale Path |
|---|---|---|
| Data volume | ~33K rows | Neon paid tier supports TB-scale |
| Concurrent users | ~10 | Vercel auto-scales serverless functions |
| Recommendation speed | SQL-based | Pre-computed similarity matrix in Redis |
| Analytics refresh | Manual pipeline run | GitHub Actions cron job |

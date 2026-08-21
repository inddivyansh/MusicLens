# 🐘 MusicLens — Database Setup Guide

This document covers local PostgreSQL development, cloud (Neon/Supabase) setup, schema creation, data loading, and running analytical queries.

---

## Architecture Overview

```
data/cleaned/*.csv
        │
        ▼
pipeline/05_load_to_postgres.py  ──►  PostgreSQL (local or Neon/Supabase)
                                              │
                              ┌───────────────┼──────────────────┐
                              ▼               ▼                  ▼
                         Star Schema    Analytical Views    Materialized View
                         (8 tables)     (6 views)          (track_feature_vectors)
```

---

## 1. Schema Design

### Entity-Relationship Diagram

```
artists (10,692)
    │ artist_id (PK)
    │ artist_name
    │
    └──► tracks (28,352) ◄──── albums (unique albums)
              │ track_id (PK)      album_id (PK)
              │ artist_id (FK)     album_name
              │ album_id (FK)      release_date
              │ track_popularity   release_year
              │ duration_ms        release_decade
              │
              ├──► audio_features (28,352)   [1:1 with tracks]
              │         track_id (PK/FK)
              │         danceability, energy, key, loudness, mode
              │         speechiness, acousticness, instrumentalness
              │         liveness, valence, tempo
              │
              └──► playlist_tracks (32,828)  [many-to-many bridge]
                        id (PK)
                        track_id (FK)
                        playlist_id
                        genre_id (FK)
                              │
                              └──► genres (24 rows)
                                        genre_id (PK)
                                        genre_name     [6 macro-genres]
                                        subgenre_name  [24 subgenres]
```

### Table Summary

| Table | Rows | Type | Description |
|---|---|---|---|
| `genres` | 24 | Dimension | 6 macro-genres × 4 subgenres |
| `artists` | 10,692 | Dimension | Unique performing artists |
| `albums` | varies | Dimension | Unique albums/singles |
| `tracks` | 28,352 | Fact | Core unique song records |
| `audio_features` | 28,352 | Fact | Spotify Echo Nest audio analysis (1:1) |
| `playlist_tracks` | 32,828 | Bridge | Many-to-many genre-playlist associations |
| `artist_stats` | 10,692 | Cache | Pre-aggregated artist metrics |
| `genre_stats` | 6 | Cache | Pre-aggregated genre audio profiles |

### Key Indexes

| Index | Table | Column(s) | Rationale |
|---|---|---|---|
| `idx_tracks_artist_id` | tracks | artist_id | All artist aggregation queries |
| `idx_tracks_popularity` | tracks | track_popularity | Top-N popularity queries |
| `idx_tracks_album_id` | tracks | album_id | Album joins and date-range queries |
| `idx_af_danceability` | audio_features | danceability | Danceability filter queries |
| `idx_af_energy` | audio_features | energy | Energy ranking queries |
| `idx_af_valence` | audio_features | valence | Mood/valence queries |
| `idx_pt_track_id` | playlist_tracks | track_id | JOIN-heavy bridge queries |
| `idx_pt_genre_id` | playlist_tracks | genre_id | Genre aggregation joins |
| `idx_artists_name` | artists | artist_name | Artist name lookups |
| `idx_albums_release_year` | albums | release_year | Temporal queries |

The current application data flow is:

```text
Kaggle dataset -> Python preprocessing -> cleaned files -> PostgreSQL analytics
               -> SQL/Power BI and precomputed JSON exports -> React/Vite frontend
```

There is currently no backend/API layer. The Vite frontend reads two precomputed JSON files and
does not query PostgreSQL. Do not put `DATABASE_URL` in Vercel or in any `VITE_*` variable.

PostgreSQL is used as the analytical database and data-engineering layer, while the deployed Vite frontend uses precomputed analytics artifacts for a lightweight serverless deployment.

---

## 2. Environment Variables

Create a `.env` file in the project root (copy from `.env.example`):

```bash
# Local PostgreSQL
DATABASE_URL=postgresql+psycopg2://your_user:your_password@localhost:5432/musiclens

# Neon PostgreSQL (production)
DATABASE_URL=postgresql+psycopg2://user:pass@ep-cool-name-123.us-east-2.aws.neon.tech/musiclens?sslmode=require

# Supabase (alternative)
DATABASE_URL=postgresql+psycopg2://postgres:your_password@db.xxxxxxxxxxxxx.supabase.co:5432/postgres
```

> **Never commit your `.env` file.** It is listed in `.gitignore`.

---

## 3. Local PostgreSQL Setup

### Install PostgreSQL

**Windows (recommended):** Download from https://www.postgresql.org/download/windows/

```powershell
# After installation, connect as postgres superuser:
psql -U postgres

# Create the musiclens database and user:
CREATE DATABASE musiclens;
CREATE USER musiclens_user WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE musiclens TO musiclens_user;
\q
```

Set in `.env`:
```
DATABASE_URL=postgresql://musiclens_user:your_password@localhost:5432/musiclens
```

---

## 4. Neon PostgreSQL Setup (Recommended for Demo/Deployment)

1. Sign up at **https://neon.tech** (free, no credit card)
2. Create a new project named `MusicLens`
3. Copy the **connection string** from the dashboard:
   ```
   postgresql://neondb_owner:<password>@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```
4. Paste it as `DATABASE_URL` in your `.env` file.

> The free tier provides **0.5 GB storage** — more than enough for this ~20 MB dataset.

---

## 5. Supabase Setup (Alternative)

1. Sign up at **https://supabase.com** (free tier: 500 MB, 2 projects)
2. Create a new project
3. Go to **Settings → Database** → copy the **URI connection string**
4. Set as `DATABASE_URL` in your `.env`

---

## 6. Schema Creation & Data Loading

Run the numbered pipeline scripts in order:

```powershell
# Activate virtual environment
.\.venv\Scripts\Activate.ps1

# Step 1: Ensure raw data exists
python pipeline/01_download_data.py

# Step 2: Clean data and export CSVs
python pipeline/02_clean_data.py

# Step 5: Create schema + load all tables into PostgreSQL
python pipeline/05_load_to_postgres.py
```

### What `05_load_to_postgres.py` does:
1. Tests database connectivity
2. Applies `sql/schema.sql` (idempotent — drops and recreates all objects)
3. Loads tables in FK-safe order: `genres → artists → albums → tracks → audio_features → playlist_tracks`
4. Computes and loads aggregated `artist_stats` and `genre_stats` caches
5. Refreshes the `track_feature_vectors` materialized view

---

## 7. Validate the Database

```powershell
python scripts/validate_db.py
```

Expected output:
```
─── 1. Database Connectivity ───────────────────────────────
  ✓ PASS  Connection test

─── 2. Table Existence ────────────────────────────────────
  ✓ PASS  Table: genres
  ✓ PASS  Table: artists
  ✓ PASS  Table: tracks
  ✓ PASS  Table: audio_features
  ✓ PASS  Table: playlist_tracks
  ...

─── 3. Row Count Validation ───────────────────────────────
  ✓ PASS  genres          :     24 rows
  ✓ PASS  artists         : 10,692 rows
  ✓ PASS  tracks          : 28,352 rows
  ✓ PASS  audio_features  : 28,352 rows
  ✓ PASS  playlist_tracks : 32,828 rows
  ✓ PASS  genre_stats     :      6 rows
```

---

## 8. Running Analytical SQL Queries

### Using psql (local)
```bash
psql -U musiclens_user -d musiclens -f sql/queries/analytical_queries.sql
```

### Using pgAdmin
Open `sql/queries/analytical_queries.sql` in the Query Tool.

### Using Python
```python
from pipeline.utils.db import fetch_all

rows = fetch_all("""
    SELECT a.artist_name, COUNT(*) AS tracks,
           ROUND(AVG(t.track_popularity)::NUMERIC, 1) AS avg_pop
    FROM tracks t JOIN artists a ON t.artist_id = a.artist_id
    GROUP BY a.artist_name
    HAVING COUNT(*) >= 5
    ORDER BY avg_pop DESC LIMIT 10
""")
for row in rows:
    print(row)
```

### Using the Analytical Views
```sql
-- Genre summary (includes popularity CI and all audio features)
SELECT * FROM v_genre_summary;

-- Top artists
SELECT * FROM v_artist_leaderboard LIMIT 20;

-- Popularity distribution
SELECT * FROM v_popularity_buckets;

-- Top songs with full context
SELECT * FROM v_top_tracks LIMIT 25;

-- Decade-by-decade audio evolution
SELECT * FROM v_release_decade_summary;

-- Subgenre-level audio profiles
SELECT * FROM v_genre_audio_profile;
```

---

## 9. Power BI Connection

1. Open Power BI Desktop
2. **Get Data → PostgreSQL database**
3. Enter server (from your Neon/Supabase connection string) and database name
4. Load the analytical views directly:
   - `v_genre_summary` — Dashboard genre overview
   - `v_artist_leaderboard` — Artist rankings
   - `v_genre_audio_profile` — Radar chart data
   - `v_top_tracks` — Track-level detail table
5. Alternatively, import the CSV exports from `data/exports/`

---

## 10. Known Limitations

| Limitation | Details |
|---|---|
| **Generated column** | `duration_min GENERATED ALWAYS AS (duration_ms / 60000.0) STORED` requires PostgreSQL ≥ 12. |
| **REFRESH CONCURRENTLY** | Requires the materialized view to have a unique index (already included). Only works if no long-running transactions. |
| **Neon idle timeout** | Free tier Neon instances auto-sleep after 5min. The `pool_pre_ping=True` in the engine factory handles reconnection. |
| **`PERCENTILE_CONT`** | Requires PostgreSQL ≥ 9.4 (available on all cloud providers). |
| **`MODE() WITHIN GROUP`** | An ordered-set aggregate; available PostgreSQL ≥ 9.4. |

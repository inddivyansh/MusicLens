# MusicLens — Architecture Document

## Overview

MusicLens is a data analytics and music recommendation platform that demonstrates production-quality data engineering using the Spotify 30,000 Songs dataset. The architecture prioritizes **free-tier deployment**, **offline-first analytics**, and **professional UI quality**.

PostgreSQL is used as the analytical database and data-engineering layer, while the deployed Vite frontend uses precomputed analytics artifacts for a lightweight serverless deployment.

---

## Architecture Pattern: Offline Pipeline + Static Frontend

### Core Principle

> All expensive computation (data cleaning, EDA, feature engineering, recommendation evaluation) happens **offline** in a Python pipeline. The deployed site loads **precomputed JSON** from `frontend/public/analytics/`.

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

**Purpose**: Serve as the analytical warehouse for SQL, validation, and Power BI Desktop. It is **not** queried by the Vercel frontend.

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
- Connection via SQLAlchemy and `psycopg2` using the `DATABASE_URL` environment variable
- Connection pooling handled by SQLAlchemy for long-lived processes; one-shot pipeline steps use `NullPool`
- Auto-suspend after 5 min idle → ~1-2s cold start on first query
- 0.5GB storage limit → our dataset uses ~15MB (well within limit)

### 3. Frontend (React + Vite)

**Purpose**: Professional analytics dashboard with interactive exploration and recommendations.

**Rendering Strategy**:
- **Static Vite build** consuming two files from `frontend/public/analytics/`: `dashboard_bundle.json` (KPIs, genres, artists, mood, feature ranges) and `search_index.json` (2,500-track recommendation catalog).
- **Client-side interactivity** for chart filtering, search, profiling, and recommendations.
- **No backend API.** The browser does not query PostgreSQL and does not run Python.
- Hosting: Vercel static output from `frontend/dist` (see `vercel.json` and `DEPLOYMENT.md`).

### 4. Recommendation & User Profiling Engine

**Purpose**: Provide transparent, explainable, and deterministic content-based recommendations and personalized music listening profiles.

#### Algorithmic Approach

1. **Feature Vector Formulation**:
   Each song $j$ is represented by a $d$-dimensional continuous audio feature vector $\mathbf{x}_j \in \mathbb{R}^9$ ($d=9$):
   $$\mathbf{x}_j = [\text{danceability}, \text{energy}, \text{loudness}, \text{speechiness}, \text{acousticness}, \text{instrumentalness}, \text{liveness}, \text{valence}, \text{tempo}]^T$$

2. **Feature Standardization**:
   Features are standardized using Z-score normalization ($\mu = 0, \sigma = 1$) to ensure equal weighting across disparate units (e.g. tempo in BPM vs danceability in $[0, 1]$):
   $$\tilde{x}_{j, k} = \frac{x_{j, k} - \mu_k}{\sigma_k}$$

3. **User Preference Vector**:
   Given a set of user-selected seed songs $S = \{s_1, s_2, \dots, s_K\}$ with optional weights $w_i$:
   $$\mathbf{u} = \sum_{i=1}^K \bar{w}_i \tilde{\mathbf{x}}_{s_i}, \quad \text{where } \bar{w}_i = \frac{w_i}{\sum_{m} w_m}$$

4. **Similarity Metric (Standardized Cosine Similarity / Pearson Correlation)**:
   $$\text{sim}(\mathbf{u}, \tilde{\mathbf{x}}_j) = \frac{\mathbf{u} \cdot \tilde{\mathbf{x}}_j}{\|\mathbf{u}\|_2 \|\tilde{\mathbf{x}}_j\|_2} \in [-1.0, 1.0]$$
   - Because features are zero-centered, cosine similarity in standardized space is mathematically equivalent to the **Pearson correlation coefficient** across audio profiles.
   - Irrelevant songs naturally produce near-zero ($~0.05$) or negative similarity, while top matching songs produce scores of $0.85 - 0.99$, providing high discriminative contrast.

5. **Explainability & Attribution Engine**:
   - Computes feature-level proximity percentages relative to full domain spans:
     $$\text{Prox}_k = \max\left(0, 1.0 - \frac{|x_{j, k} - \mu_{u, k}|}{\text{span}_k}\right) \times 100\%$$
   - Identifies top 3 most aligned audio attributes (e.g., *"Danceability Match: 98%"*, *"Energy Match: 96%"*).
   - Reports signed raw feature deltas $\Delta_k = x_{j, k} - \mu_{u, k}$.
   - Detects macro-genre and subgenre alignment.

6. **User Listening Personality Archetypes**:
   Derived from average audio signatures and Russell's Circumplex Mood Model:
   - *High-Energy Party Enthusiast* ($\text{Energy} \ge 0.75, \text{Danceability} \ge 0.70$)
   - *Acoustic & Introspective Soul* ($\text{Acousticness} \ge 0.50, \text{Energy} < 0.55$)
   - *Euphoric Groove Explorer* ($\text{Valence} \ge 0.65, \text{Danceability} \ge 0.60$)
   - *Nocturnal Adrenaline Seeker* ($\text{Energy} \ge 0.72, \text{Valence} < 0.45$)
   - *Atmospheric & Instrumental Dreamer* ($\text{Instrumentalness} \ge 0.35$)
   - *Lyrical Flow & Rhythm Connoisseur* ($\text{Speechiness} \ge 0.15, \text{Danceability} \ge 0.60$)
   - *Eclectic Sonic Connoisseur* (Balanced multi-genre profile)

#### Design Trade-offs & Future Extensions

| Dimension | Content-Based (Current) | Collaborative Filtering (Future) |
|---|---|---|
| **Cold-Start Problem** | **Zero cold-start**: Recommends immediately from 1 seed song. | Requires large historical user interaction matrix ($U \times I$). |
| **Explainability** | **100% Explainable**: Direct audio feature attribution. | Latent factors (embeddings) lack direct physical meaning. |
| **Diversity / Serendipity** | Tends to recommend acoustically similar tracks (filter bubble). | Discovers unexpected cross-genre associations based on community listening. |
| **Data Requirement** | Catalog audio features only (self-contained). | User ratings, stream counts, skips, play completions. |
| **Hybrid Path** | N/A | Combine content-based audio similarity with collaborative matrix factorization (ALS/LightFM). |

### 5. Power BI Integration

**Purpose**: Document how an analyst can build a dashboard in **Power BI Desktop**. This repository does **not** include a published Power BI Service report.

**Connection Methods**:
1. **Direct PostgreSQL connection** — Power BI Desktop → local or Neon PostgreSQL (credentials stay on the analyst machine)
2. **CSV export** — `data/exports/powerbi/` after running `pipeline/07_export_analytics.py`
3. **SQL views** — pre-built analytical views in `sql/schema.sql`

---

## Data Flow

```
                    OFFLINE (Local)                           ONLINE (Cloud)
    ┌─────────────────────────────────────┐    ┌─────────────────────────────────┐
    │  Kaggle CSV                         │    │  Static React/Vite frontend     │
    │     ↓                               │    │  on Vercel                      │
    │  Python Pipeline                    │    │     ↕                           │
    │     ↓              ↓                │    │  dashboard_bundle.json          │
    │  JSON artifacts   PostgreSQL        │    │  search_index.json              │
    │  (git commit      (SQL / Power BI   │    │  (no live SQL from browser)     │
    │   two JSON files)  Desktop only)    │    │                                 │
    └─────────────────────────────────────┘    └─────────────────────────────────┘
```

---

## Security

- All credentials stored in environment variables
- `.env` never committed (enforced by `.gitignore`)
- Neon connections require SSL (`?sslmode=require`)
- The Vercel project does **not** need environment variables for the current static app
- No API keys or `DATABASE_URL` are exposed to client-side code
- Database user has minimal required permissions

---

## Scalability Considerations

While designed for a demo/portfolio context, the architecture scales naturally:

| Concern | Current (Demo) | Scale Path |
|---|---|---|
| Data volume | ~33K rows | Neon paid tier supports TB-scale |
| Concurrent users | Static asset delivery | Add an API layer only if runtime database queries are needed |
| Recommendation speed | Client-side cosine over 2,500 catalog rows | Pre-computed matrix only if the catalog grows |
| Analytics refresh | Manual pipeline run | GitHub Actions cron job |

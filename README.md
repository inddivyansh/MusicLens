# MusicLens

Analytics and content-based recommendation platform for the [Spotify 30,000 Songs](https://www.kaggle.com/datasets/joebeachcapital/30000-spotify-songs) Kaggle dataset.

The Python pipeline cleans the catalog, loads a PostgreSQL warehouse, and exports compact JSON. A React + Vite dashboard visualizes those exports and runs recommendations in the browser.

PostgreSQL is the analytical / data-engineering layer. The deployed frontend uses precomputed artifacts only. The browser never receives `DATABASE_URL`.

---

## Features

- Catalog KPIs, genre volume, popularity confidence intervals, and artist leaderboards
- Audio-feature comparison across six macro-genres, mood quadrants, and ANOVA summaries
- Explainable content-based recommendations with a derived listener profile
- Power BI Desktop specification plus CSV / SQL view connection notes
- Static hosting on Vercel (Hobby / free tier)

---

## Architecture

```
Kaggle CSV
    → Python pipeline (clean, EDA, features, SQL load, recommender eval)
    → PostgreSQL warehouse (local, Neon, or Supabase)
    → JSON exports (dashboard_bundle.json, search_index.json)
    → React + Vite (static)
    → Vercel
```

Details: [ARCHITECTURE.md](./ARCHITECTURE.md). Deployment: [DEPLOYMENT.md](./DEPLOYMENT.md). Schema: [sql/DATABASE_SETUP.md](./sql/DATABASE_SETUP.md). Fields: [DATA_DICTIONARY.md](./DATA_DICTIONARY.md).

---

## Data pipeline

| Step | Script | Output |
|---|---|---|
| 1 | `pipeline/01_download_data.py` | `data/raw/spotify_songs.csv` |
| 2 | `pipeline/02_clean_data.py` | Star-schema CSVs under `data/cleaned/` |
| 3 | `pipeline/03_eda.py` | Stats, figures, `data/exports/` summaries |
| 4 | `pipeline/04_feature_engineering.py` | Enriched tracks, scaler, feature ranges |
| 5 | `pipeline/05_load_to_postgres.py` | Warehouse tables and views |
| 6 | `pipeline/06_build_recommendations.py` | Offline evaluation artifacts |
| 7 | `pipeline/07_export_analytics.py` | Frontend JSON + Power BI CSVs |

Shared config: `pipeline/config.py`. Utilities: `pipeline/utils/`.

---

## Analytics

EDA and SQL cover genre mix, popularity, audio distributions, correlations, and temporal breakdowns. The UI Overview and Audio Analytics tabs read `dashboard_bundle.json` (aggregates only — not the full 28k-row table).

Interactive EDA: `notebooks/01_exploratory_data_analysis.ipynb`.

---

## Recommendation system

**Module:** `pipeline/utils/recommender.py` (Python) and `frontend/src/utils/recommenderClient.js` (browser).

- 9 continuous features, z-score standardized, cosine similarity (Pearson-equivalent in that space)
- User profile: mean audio vector, dominant genres, Russell circumplex mood mix, personality archetype
- Each recommendation lists top matching features and a short explanation
- Seeds are excluded; ranking is deterministic (similarity, then popularity, then `track_id`)

The browser catalog is the **top 2,500 tracks by popularity**, not the full warehouse.

---

## Technology stack

| Layer | Technology |
|---|---|
| Pipeline | Python 3.12, Pandas, NumPy, SciPy, scikit-learn |
| Database | PostgreSQL (SQLAlchemy + psycopg2) |
| Frontend | React 18, Vite 5, Tailwind CSS 3 |
| Hosting | Vercel (static), optional Neon/Supabase for SQL |

---

## Database

Star schema: `tracks`, `audio_features`, `playlist_tracks`, plus dimensions and analytical views in `sql/schema.sql`. Queries: `sql/queries/analytical_queries.sql`. Validation: `scripts/validate_db.py`.

The hosted site does **not** connect to Postgres.

---

## Local setup

Prerequisites: Python 3.12, Node.js 18+, Git. Optional: PostgreSQL.

```powershell
git clone https://github.com/inddivyansh/MusicLens.git
cd MusicLens

py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
# Set DATABASE_URL and Kaggle credentials in .env (pipeline only)

python pipeline/01_download_data.py
python pipeline/02_clean_data.py
python pipeline/03_eda.py
python pipeline/04_feature_engineering.py
python pipeline/05_load_to_postgres.py   # optional for the UI
python pipeline/06_build_recommendations.py
python pipeline/07_export_analytics.py

python -m pytest -v

cd frontend
npm install
npm run dev
```

Windows helper: `.\scripts\setup_env.ps1` (venv + pip). UI: `http://localhost:3000`.

---

## Deployment

Static Vite build on Vercel. Build: `npm run build --prefix frontend`. Output: `frontend/dist`. No Vercel env vars. Do not run the Python pipeline or Kaggle download in CI.

See [DEPLOYMENT.md](./DEPLOYMENT.md).

---

## Dataset

**Source:** [joebeachcapital/30000-spotify-songs](https://www.kaggle.com/datasets/joebeachcapital/30000-spotify-songs)

- 32,828 cleaned playlist appearances → **28,352 unique tracks**
- 10,692 artists, 6 macro-genres, 24 subgenres, years 1957–2020
- Audio features: danceability, energy, key, loudness, mode, speechiness, acousticness, instrumentalness, liveness, valence, tempo

Raw and cleaned files stay in `data/` (gitignored).

---

## Limitations

- Recommendations search 2,500 catalog rows, not all 28,352 tracks
- No collaborative filtering or live Spotify API
- Analytics refresh requires re-running the pipeline and committing JSON
- Power BI materials are a Desktop specification and export recipe, not a published `.pbix`
- UI tabs are in-memory; a refresh returns to Overview

---

## Project structure

```
MusicLens/
├── pipeline/              # Numbered Python pipeline + utils
├── sql/                   # Schema, analytical SQL, setup notes
├── tests/                 # pytest (preprocessing, recommender, DB)
├── notebooks/             # EDA notebook
├── frontend/              # React + Vite app
│   └── public/analytics/  # dashboard_bundle.json, search_index.json
├── powerbi/               # Dashboard specification
├── scripts/               # validate_db.py, setup_env.ps1
├── ARCHITECTURE.md
├── DATA_DICTIONARY.md
├── DEPLOYMENT.md
├── vercel.json
└── requirements.txt
```

---

## License

MIT

## Author

[inddivyansh](https://github.com/inddivyansh)

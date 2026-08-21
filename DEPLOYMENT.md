# MusicLens Deployment Guide

This repository deploys a **static React + Vite frontend**. The Python pipeline and PostgreSQL warehouse run locally (or on a free Postgres host) and are **not** part of the Vercel build.

PostgreSQL is used as the analytical database and data-engineering layer, while the deployed Vite frontend uses precomputed analytics artifacts for a lightweight serverless deployment.

Do not set `DATABASE_URL`, Kaggle keys, or database passwords in Vercel. The browser never connects to PostgreSQL.

---

## A. Local development

Prerequisites: Python 3.12, Node.js 18+, Git.

```powershell
git clone https://github.com/inddivyansh/MusicLens.git
cd MusicLens

py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt

Copy-Item .env.example .env
# Edit .env with local/pipeline secrets only

cd frontend
npm install
npm run dev
```

The Vite dev server defaults to `http://localhost:3000`. It reads JSON from `frontend/public/analytics/`.

---

## B. Running the Python pipeline

From the repository root, with the virtual environment active:

```powershell
python pipeline/01_download_data.py
python pipeline/02_clean_data.py
python pipeline/03_eda.py
python pipeline/04_feature_engineering.py
python pipeline/05_load_to_postgres.py
python pipeline/06_build_recommendations.py
python pipeline/07_export_analytics.py
```

Step 01 needs Kaggle credentials. Step 05 needs `DATABASE_URL`. Steps 03, 04, 06, and 07 write local artifacts under `data/exports/` (gitignored).

---

## C. PostgreSQL setup

See [sql/DATABASE_SETUP.md](./sql/DATABASE_SETUP.md).

Summary:

1. Create a local Postgres database **or** a Neon/Supabase project.
2. Put the SQLAlchemy URL in `.env` as `DATABASE_URL`.
3. Run `python pipeline/05_load_to_postgres.py`.
4. Validate with `python scripts/validate_db.py`.

PostgreSQL is optional for the **deployed website**. It is required for SQL analytics, warehouse validation, and Power BI Desktop connections.

---

## D. Generating analytics exports

```powershell
python pipeline/07_export_analytics.py
```

This writes the only two frontend payloads Vercel should ship:

| File | Used by |
|---|---|
| `frontend/public/analytics/dashboard_bundle.json` | Overview, Audio Analytics |
| `frontend/public/analytics/search_index.json` | Profile & Recommender (2,500-track catalog) |

The full 28,352-track dataset is **not** copied into the browser bundle. Power BI CSVs stay in `data/exports/powerbi/` (local only).

After regenerating exports, commit the two JSON files if the deployed site should update.

---

## E. Building the frontend

```powershell
cd frontend
npm install
npm run build
npm run preview
```

`npm run build` must succeed before deploying. Output directory: `frontend/dist`.

---

## F. Creating a Vercel project

1. Sign in at [https://vercel.com](https://vercel.com) (Hobby / free tier).
2. Click **Add New… → Project**.
3. Import the GitHub repository `inddivyansh/MusicLens`.
4. Keep the **project root as the Git repository root**. This repo already contains `vercel.json`.

Do **not** also set Root Directory to `frontend/` if you use the root `vercel.json`. That would nest paths twice.

---

## G. Setting the correct Vercel root directory

**Recommended:** leave Root Directory empty / `.` and use the committed `vercel.json`.

**Alternative:** delete the root `vercel.json` settings from the dashboard override and set:

- Root Directory: `frontend`
- Framework: Vite
- Build Command: `npm run build`
- Output Directory: `dist`

Use one of these patterns, not both.

---

## H. Build command

Configured in `vercel.json`:

```text
npm run build --prefix frontend
```

Equivalent local command:

```text
cd frontend && npm install && npm run build
```

The Vercel build must **not** run Python, Kaggle downloads, or Postgres loaders.

---

## I. Output directory

```text
frontend/dist
```

Vite copies `frontend/public/analytics/*.json` into that dist folder automatically.

---

## J. Environment variables

**Vercel frontend: none required.**

| Variable | Where it belongs | Exposed to browser? |
|---|---|---|
| `DATABASE_URL` | Local `.env` / pipeline only | No |
| `KAGGLE_USERNAME` / `KAGGLE_KEY` | Local `.env` / pipeline only | No |
| `APP_ENV` | Local pipeline only | No |
| `VITE_*` | Not used | Would be public if added |

If you add a frontend variable later, it must be prefixed with `VITE_` and must never contain secrets.

---

## K. Deploying from GitHub

1. Push the branch that contains `frontend/`, `vercel.json`, and `frontend/public/analytics/*.json`.
2. In Vercel, the GitHub integration builds on each push to the production branch.
3. Confirm the deployment logs show `vite build` and **not** `pip` / `python`.
4. Open the `*.vercel.app` URL Vercel prints.

This guide does **not** claim a live production URL until that URL has been opened and checked.

---

## L. Updating the deployed application

1. Change pipeline or frontend code locally.
2. If analytics should change, re-run `python pipeline/07_export_analytics.py`.
3. Run `python -m pytest -v` and `cd frontend; npm run build`.
4. Commit (never commit `.env`, `.venv`, `data/`, or `node_modules`).
5. Push to GitHub. Vercel rebuilds the static site.

Refreshing warehouse SQL does **not** update the live site until step 07 JSON is regenerated and committed.

---

## M. Troubleshooting common deployment failures

| Symptom | Likely cause | Fix |
|---|---|---|
| Build looks for `package.json` at repo root | Root Directory set to `.` without using `vercel.json` | Use the committed `vercel.json`, or set Root Directory to `frontend` |
| Blank page / 404 on `/analytics/*.json` | Analytics JSON not committed, or Root Directory nested twice | Commit `frontend/public/analytics/*.json`; do not set Root Directory to `frontend` **and** keep `outputDirectory: frontend/dist` |
| Layout looks unstyled | Tailwind not installed / build cache | From `frontend/`, `npm install` then `npm run build` |
| “Analytics could not be loaded” | Missing or malformed JSON | Re-run `pipeline/07_export_analytics.py` |
| Recommender returns empty results | Filters too strict, or empty seed list | Clear genre/popularity filters; pick a persona |
| Build tries to download Kaggle data | Custom build command added | Restore `npm run build --prefix frontend` |
| Database errors in Vercel logs | Someone added `DATABASE_URL` to the frontend project | Remove it. The static app does not use Postgres |

SPA note: this app uses in-page tabs, not React Router. Refreshing `/` always returns the Overview tab. No rewrite to `index.html` is required for extra routes.

---

## What is not deployed

- Python virtualenv and pipeline
- Raw/cleaned CSVs under `data/`
- Neon/Supabase (unless you use it yourself for SQL / Power BI Desktop)
- A published Power BI Service dashboard (the in-app tab is a specification)
- Any backend API

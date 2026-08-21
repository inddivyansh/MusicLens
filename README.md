# 🎵 MusicLens

**A production-quality data analytics and music recommendation platform** built on the Spotify 30,000 Songs dataset.

Demonstrates end-to-end data engineering: from raw data cleaning through statistical analysis, PostgreSQL warehousing, interactive visualizations, content-based recommendations, and deployment on free-tier cloud services.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Data Pipeline** | Python 3.12, Pandas, NumPy, SciPy |
| **Database** | PostgreSQL (Neon free tier) |
| **Analytics** | Matplotlib, Seaborn, Plotly, SQL |
| **Recommendations** | Scikit-learn (content-based filtering) |
| **Frontend** | Next.js (Vercel free tier) |
| **BI Integration** | Power BI-compatible exports |
| **Version Control** | Git / GitHub |

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  LOCAL PYTHON PIPELINE                                        │
│  Raw CSV → Clean → EDA → Feature Eng → Load to PG → Export  │
└───────────────┬──────────────────────────┬───────────────────┘
                │                          │
         JSON artifacts              Neon PostgreSQL
                │                          │
┌───────────────▼──────────────────────────▼───────────────────┐
│  VERCEL (Next.js)                                             │
│  Static Analytics Pages  ←→  API Routes  ←→  Neon PG         │
└──────────────────────────────────────────────────────────────┘
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed documentation.

## Quick Start

### Prerequisites
- Python 3.12
- Node.js 18+ (for frontend)
- Git

### 1. Clone & Setup Environment

```powershell
git clone https://github.com/inddivyansh/MusicLens.git
cd MusicLens

# Create Python virtual environment
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1

# Install Python dependencies
pip install -r requirements.txt
```

### 2. Configure Environment

```powershell
# Copy and edit environment variables
Copy-Item .env.example .env
# Edit .env with your database URL and Kaggle credentials
```

### 3. Run Data Pipeline

```powershell
# Download dataset
python pipeline/01_download_data.py

# Clean data
python pipeline/02_clean_data.py

# Run EDA
python pipeline/03_eda.py

# Feature engineering
python pipeline/04_feature_engineering.py

# Load to PostgreSQL
python pipeline/05_load_to_postgres.py

# Build recommendations
python pipeline/06_build_recommendations.py

# Export analytics for frontend
python pipeline/07_export_analytics.py
```

### 4. Run Frontend (Development)

```powershell
cd frontend
npm install
npm run dev
```

## Dataset

**Source**: [30,000 Spotify Songs](https://www.kaggle.com/datasets/joebeachcapital/30000-spotify-songs) from Kaggle

- **32,833 rows** × **23 columns**
- Audio features: danceability, energy, loudness, speechiness, acousticness, instrumentalness, liveness, valence, tempo
- Metadata: track name, artist, album, release date, popularity
- Playlist context: genre, subgenre, playlist name

## Project Structure

```
MusicLens/
├── pipeline/          # Python data pipeline (numbered scripts)
├── sql/               # Database schema & analytical queries
├── notebooks/         # Jupyter exploration notebooks
├── frontend/          # Next.js web application
├── data/              # Local data files (gitignored)
├── powerbi/           # Power BI integration guides
├── scripts/           # Utility scripts
├── .env.example       # Environment variable template
├── requirements.txt   # Python dependencies
├── ARCHITECTURE.md    # Detailed architecture documentation
└── DEVELOPMENT_LOG.md # Development journal
```

## Deployment

| Service | Platform | Cost |
|---|---|---|
| Frontend + API | Vercel (Hobby) | Free |
| Database | Neon PostgreSQL | Free |
| Pipeline | Local / GitHub Actions | Free |

**Total monthly cost: $0**

## License

MIT

## Author

[inddivyansh](https://github.com/inddivyansh)

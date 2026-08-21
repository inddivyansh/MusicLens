# MusicLens — Development Log

> Living document tracking all development activity, decisions, bugs, and fixes.

---

## Entry 001 — Project Initialization

**Date**: 2026-08-21
**Objective**: Set up project structure, environment, tooling, and documentation.

### Context
- Dataset: [30,000 Spotify Songs](https://www.kaggle.com/datasets/joebeachcapital/30000-spotify-songs) (32,833 rows × 23 columns)
- Repository: https://github.com/inddivyansh/MusicLens

### Files Created
- `.gitignore`, `.env.example`, `README.md`, `ARCHITECTURE.md`, `DEVELOPMENT_LOG.md`, `requirements.txt`
- `pipeline/__init__.py`, `pipeline/config.py`, `pipeline/utils/__init__.py`, `pipeline/utils/db.py`
- `sql/schema.sql`, `scripts/setup_env.ps1`, `powerbi/README.md`

### Decisions & Approach
- Chose **Option C: Next.js static/ISR frontend + Neon PostgreSQL + offline Python pipeline**.
- Selected **Python 3.12.10** for stability and compatibility.
- Implemented star schema: `tracks` (dim), `audio_features` (fact), `playlist_tracks` (bridge).

---

## Entry 002 — Ingestion, Cleaning & Exploratory Data Analysis

**Date**: 2026-08-21
**Objective**: Implement reproducible ingestion, robust data cleaning, star-schema relational exports, in-depth statistical EDA, publication-grade visualizations, data dictionary, and automated test suite.

### Dataset Structure Discovered
- **Raw File**: `data/raw/spotify_songs.csv` (7,971,379 bytes).
- **Dimensions**: 32,833 rows × 23 columns.
- **Missing Values**: Exactly 5 rows had `NaN` values across `track_name`, `track_artist`, and `track_album_name` (accounting for 4 unique `track_id`s). 0 missing values across all 12 numeric audio feature columns.
- **Uniqueness & Duplication**:
  - 28,356 unique `track_id`s in raw data (28,352 unique valid tracks after dropping 4 unlabelled entries).
  - 4,476 duplicate track appearances caused strictly by Spotify songs appearing in multiple curated playlists across genres/subgenres.
  - Verification proved that audio features and metadata are 100% identical and consistent across duplicate `track_id` occurrences.
- **Genres & Subgenres**:
  - 6 macro-genres: `edm` (6,043), `rap` (5,746), `pop` (5,507), `r&b` (5,431), `latin` (5,155), `rock` (4,951).
  - 24 subgenres (4 subgenres per macro-genre).
- **Date Variations**: 30,947 dates in `YYYY-MM-DD` format, 1,855 dates in `YYYY` format, 31 dates in `YYYY-MM` format.

### Files Created / Modified
| File | Action | Purpose |
|---|---|---|
| `pipeline/01_download_data.py` | Created | Automated download via `kagglehub` with fallback to local archive and sanity checks. |
| `pipeline/02_clean_data.py` | Created | Complete cleaning pipeline: whitespace stripping, missing metadata drop, ISO date standardization, domain bounds validation, and dual CSV/Parquet star schema export. |
| `pipeline/03_eda.py` | Created | Statistical EDA answering all 10 core questions, generating visual charts, and exporting JSON/CSV artifacts. |
| `pipeline/utils/stats.py` | Created | Summary statistics (skew, kurtosis, IQR), Pearson/Spearman correlations with p-values, ANOVA, and Kruskal-Wallis tests. |
| `pipeline/utils/viz.py` | Created | High-resolution visualization generator (distributions, heatmaps, violin plots, radar profiles). |
| `notebooks/01_exploratory_data_analysis.ipynb` | Created | Interactive Jupyter notebook demonstrating the complete exploratory workflow. |
| `DATA_DICTIONARY.md` | Created | Detailed field specifications, domain ranges, semantic meanings, and relational table mappings. |
| `tests/test_preprocessing.py` | Created | Automated unit tests for data cleaning, date parsing, statistical metrics, and disk integrity. |
| `requirements.txt` | Modified | Added `pyarrow` for parquet serialization. |

### Generated Clean Data Artifacts (`data/cleaned/`)
- `spotify_songs_cleaned.csv` & `.parquet` (32,828 rows, denormalized)
- `tracks.csv` & `.parquet` (28,352 rows, unique track dimension)
- `audio_features.csv` & `.parquet` (28,352 rows, 1:1 fact table)
- `playlist_tracks.csv` & `.parquet` (32,828 rows, bridge table)

### Generated Analytical Artifacts (`data/exports/` & `frontend/public/analytics/`)
- `eda_summary.json`: Comprehensive answers, metrics, and interpretations for all 10 EDA questions.
- `genre_metrics.json` & `.csv`: Genre-level counts, percentages, mean/median popularity, and CI bounds.
- `artist_metrics.json` & `.csv`: Artist-level metrics (filtered with $\ge 3$ and $\ge 5$ track thresholds).
- `feature_distributions.json`: Detailed parametric & non-parametric diagnostics for all 11 numeric features.
- `correlation_matrix.json`: Full feature correlation matrix with p-values.
- Visual charts:
  - `01_genre_distribution.png`
  - `02_genre_popularity_comparison.png`
  - `03_feature_distributions.png`
  - `04_correlation_heatmap.png`
  - `05_genre_radar_profile.png`

### Core EDA Findings & Answers
1. **Song Count**: 32,828 valid track-playlist entries representing 28,352 unique Spotify songs. 4,476 tracks (15.8%) appear in multiple playlists.
2. **Artists**: 10,692 unique artists. The catalog is long-tailed: median artist has 1 song; top prolific artist in catalog is Martin Garrix (161 unique songs).
3. **Genres**: 6 macro-genres and 24 subgenres (4 subgenres per macro-genre).
4. **Volume Leader**: `EDM` contains the most entries (6,043, 18.4%), followed by `Rap` (5,746, 17.5%) and `Pop` (5,507, 16.8%).
5. **Genre Popularity**: `Latin` achieves highest average popularity ($47.03 \pm 0.61$), followed by `Pop` (47.74 on unique tracks) and `Rock` (41.73). `EDM` is the lowest (34.83). One-Way ANOVA ($F = 217.3, p < 0.001$) and Kruskal-Wallis ($H = 1018.6, p < 0.001$) confirm highly significant variance across genres.
6. **Artist Popularity**: Controlling for track count ($\ge 5$ tracks), *Bad Bunny* ranks #1 (mean popularity 79.4 across 10 tracks), followed by *Daddy Yankee* (78.3 across 6 tracks) and *Ozuna* (76.8 across 9 tracks).
7. **Distributions**:
   - Danceability (mean 0.65, median 0.67, skew -0.42): moderately left-skewed, center of mass in commercial pop rhythm.
   - Energy (mean 0.70, median 0.72, skew -0.63): moderately negative skew; commercial streaming favors energetic mastering.
   - Loudness (mean -6.72 dB, median -6.17 dB, skew -1.50): negative skew with heavy tail towards quiet recordings.
   - Speechiness (mean 0.11, median 0.06, skew 2.08): highly right-skewed; 8.8% outliers above 0.33 representing rap and spoken skits.
   - Instrumentalness (mean 0.08, median 0.00, skew 3.12): extreme right-skew; over 60% of tracks have 0 instrumentalness.
8. **Correlations with Popularity**: Raw acoustic features exhibit weak linear correlation with popularity:
   - Loudness ($r = +0.058, p < 0.001$) and Danceability ($r = +0.065, p < 0.001$) have slight positive correlation.
   - Instrumentalness ($r = -0.095, p < 0.001$) and Acousticness ($r = -0.085, p < 0.001$) have negative correlation.
   - *Interpretation*: Popularity is driven by artist brand equity, marketing, cultural trends, and playlist placement rather than isolated acoustic signatures.
9. **Cross-Genre Variations**: Every audio feature differs significantly across genres ($p < 0.001$). Danceability ($\eta^2 = 0.187$) and Energy ($\eta^2 = 0.142$) have the largest effect sizes. EDM has highest energy ($0.80$) and tempo ($124.7$ BPM); Rap leads in speechiness ($0.22$) and danceability ($0.72$); Latin leads in valence ($0.61$) and danceability ($0.71$); Rock has high energy ($0.73$) with low speechiness ($0.05$).
10. **Outliers**: Identified real-world edge cases including a 4.0-second comedy skit (*Hi, How're You Doin'?*, duration 4,000ms, tempo 0 BPM), extended 8.6-minute DJ/rock arrangements, and live stadium performances (liveness $> 0.8$). These represent acoustic diversity rather than data corruption.

### Bugs Encountered & Fixes
| Issue | Root Cause | Fix |
|---|---|---|
| `ModuleNotFoundError: No module named 'pipeline'` | Running scripts via `python pipeline/01_...` does not include project root in `sys.path`. | Added automatic `sys.path.insert(0, str(PROJECT_ROOT))` at top of all pipeline scripts. |
| `ImportError: Unable to find a usable engine (pyarrow/fastparquet)` | Pandas `to_parquet` requires optional engine. | Installed `pyarrow==25.0.1` and pinned in `requirements.txt`. |
| `KeyError: 'duration_ms'` in EDA | `duration_ms` was excluded from audio feature list during distribution calculation. | Added `duration_ms` to numerical distribution analysis. |
| `SyntaxError: invalid decimal literal` in tests | Python syntax disallows `from pipeline.02_clean_data import ...` due to leading digit in module name. | Used `importlib.import_module("pipeline.02_clean_data")` in unit test suite. |
| Seaborn `FutureWarning` in violinplot | Missing `hue` parameter in `sns.violinplot`. | Added `hue=genre_col` and `legend=False`. |

### Validation Performed
- Ran full pipeline: `01_download_data.py` $\rightarrow$ `02_clean_data.py` $\rightarrow$ `03_eda.py`.
- Verified all exported CSV, Parquet, JSON, and PNG files exist and are populated.
- Executed unit test suite: `9 passed, 0 failed in 0.526s`.

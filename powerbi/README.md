# Power BI Integration

## Connecting Power BI to MusicLens

### Option 1: Direct PostgreSQL Connection

1. Open Power BI Desktop
2. Get Data → PostgreSQL database
3. Enter the Neon connection details from your `.env` file:
   - Server: `ep-xxx.us-east-2.aws.neon.tech`
   - Database: `musiclens`
4. Use the analytical views:
   - `genre_summary` — Genre distribution with average audio features
   - `artist_leaderboard` — Top artists by popularity
   - `track_feature_vectors` — Full feature dataset for custom analysis

### Option 2: CSV/Parquet Export

Pre-exported files are available in `data/exports/` after running the pipeline:
- `spotify_songs_cleaned.csv` — Full cleaned dataset
- `genre_summary.csv` — Aggregated genre statistics
- `artist_stats.csv` — Artist-level metrics

### Option 3: SQL Queries

Custom SQL queries are available in `sql/queries/` directory.
Import these directly into Power BI's Advanced Query Editor.

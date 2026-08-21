"""
MusicLens — Database Validation Script
========================================
Connects to PostgreSQL, verifies table existence, checks expected row counts,
and runs representative analytical queries to confirm the database is correct.

Usage:
    python scripts/validate_db.py

Requires DATABASE_URL to be set in your .env file.
"""

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from sqlalchemy import text
from pipeline.utils.db import get_engine, test_connection, fetch_all, fetch_scalar

# -----------------------------------------------------------------------
# Expected dataset counts (from Phase 2 preprocessing)
# -----------------------------------------------------------------------
EXPECTED_COUNTS = {
    "genres":          24,       # 24 genre+subgenre rows
    "artists":       10692,      # unique artists
    "albums":        None,       # varies due to album deduplication
    "tracks":        28352,      # unique tracks after removing 5 null rows
    "audio_features":28352,      # 1:1 with tracks
    "playlist_tracks":32828,     # full playlist-track bridge
    "artist_stats":  None,       # equal to artists count
    "genre_stats":   6,          # one row per macro-genre
}

PASS = "\033[92m✓ PASS\033[0m"
FAIL = "\033[91m✗ FAIL\033[0m"
WARN = "\033[93m⚠ WARN\033[0m"


def check_connectivity() -> bool:
    print("\n─── 1. Database Connectivity ───────────────────────────────")
    ok = test_connection()
    print(f"  {PASS if ok else FAIL}  Connection test")
    return ok


def check_schema(engine) -> bool:
    print("\n─── 2. Table Existence ────────────────────────────────────")
    required_tables = [
        "genres", "artists", "albums", "tracks",
        "audio_features", "playlist_tracks", "artist_stats", "genre_stats"
    ]
    from sqlalchemy import inspect as sa_inspect
    inspector = sa_inspect(engine)
    existing = set(inspector.get_table_names(schema="public"))
    all_present = True

    for tbl in required_tables:
        present = tbl in existing
        all_present = all_present and present
        print(f"  {PASS if present else FAIL}  Table: {tbl}")

    # Check views
    views = inspector.get_view_names(schema="public")
    expected_views = [
        "v_genre_summary", "v_artist_leaderboard", "v_popularity_buckets",
        "v_top_tracks", "v_release_decade_summary", "v_genre_audio_profile",
    ]
    for v in expected_views:
        present = v in views
        all_present = all_present and present
        print(f"  {PASS if present else FAIL}  View:  {v}")

    return all_present


def check_row_counts(engine) -> bool:
    print("\n─── 3. Row Count Validation ───────────────────────────────")
    all_ok = True

    with engine.connect() as conn:
        for table, expected in EXPECTED_COUNTS.items():
            try:
                actual = conn.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar()
                if expected is None:
                    print(f"  {WARN}  {table:<20}: {actual:>7,} rows (no expected value set)")
                elif actual == expected:
                    print(f"  {PASS}  {table:<20}: {actual:>7,} rows (expected {expected:,})")
                else:
                    delta = actual - expected
                    print(f"  {FAIL}  {table:<20}: {actual:>7,} rows (expected {expected:,}, delta {delta:+,})")
                    all_ok = False
            except Exception as e:
                print(f"  {FAIL}  {table:<20}: ERROR — {e}")
                all_ok = False

    return all_ok


def run_analytical_checks(engine) -> None:
    print("\n─── 4. Representative Analytical Queries ──────────────────")

    with engine.connect() as conn:

        # Genre breakdown
        print("\n  ► Genre distribution:")
        rows = conn.execute(text("""
            SELECT g.genre_name, COUNT(DISTINCT pt.track_id) AS unique_tracks,
                   ROUND(AVG(t.track_popularity)::NUMERIC, 2) AS avg_pop
            FROM playlist_tracks pt
            JOIN genres g ON pt.genre_id = g.genre_id
            JOIN tracks t ON pt.track_id = t.track_id
            GROUP BY g.genre_name
            ORDER BY unique_tracks DESC
        """)).fetchall()
        for r in rows:
            print(f"    {r.genre_name:<8}: {r.unique_tracks:>5,} tracks  avg_pop={r.avg_pop}")

        # Top 5 artists by avg popularity (min 5 tracks)
        print("\n  ► Top 5 artists by avg popularity (≥5 tracks):")
        rows = conn.execute(text("""
            SELECT a.artist_name, COUNT(*) AS cnt,
                   ROUND(AVG(t.track_popularity)::NUMERIC, 1) AS avg_pop
            FROM tracks t JOIN artists a ON t.artist_id = a.artist_id
            GROUP BY a.artist_name HAVING COUNT(*) >= 5
            ORDER BY avg_pop DESC LIMIT 5
        """)).fetchall()
        for i, r in enumerate(rows, 1):
            print(f"    #{i} {r.artist_name:<25}: avg_pop={r.avg_pop} ({r.cnt} tracks)")

        # Audio feature check: expected ranges
        print("\n  ► Audio feature range validation:")
        checks = [
            ("danceability",    "MIN(danceability) >= 0 AND MAX(danceability) <= 1"),
            ("energy",          "MIN(energy) >= 0 AND MAX(energy) <= 1"),
            ("speechiness",     "MIN(speechiness) >= 0 AND MAX(speechiness) <= 1"),
            ("instrumentalness","MIN(instrumentalness) >= 0 AND MAX(instrumentalness) <= 1"),
            ("valence",         "MIN(valence) >= 0 AND MAX(valence) <= 1"),
            ("tempo",           "MIN(tempo) >= 0 AND MAX(tempo) <= 300"),
        ]
        for feat, condition in checks:
            ok = conn.execute(text(f"SELECT {condition} FROM audio_features")).scalar()
            print(f"    {PASS if ok else FAIL}  {feat} within expected range")

        # Referential integrity spot-check
        print("\n  ► Referential integrity check:")
        orphan_af = conn.execute(text(
            "SELECT COUNT(*) FROM audio_features af WHERE NOT EXISTS "
            "(SELECT 1 FROM tracks t WHERE t.track_id = af.track_id)"
        )).scalar()
        orphan_pt = conn.execute(text(
            "SELECT COUNT(*) FROM playlist_tracks pt WHERE NOT EXISTS "
            "(SELECT 1 FROM tracks t WHERE t.track_id = pt.track_id)"
        )).scalar()
        print(f"    {PASS if orphan_af == 0 else FAIL}  audio_features orphan rows: {orphan_af}")
        print(f"    {PASS if orphan_pt == 0 else FAIL}  playlist_tracks orphan rows: {orphan_pt}")

        # CTE query test
        print("\n  ► CTE query (genre audio deviation from global mean):")
        rows = conn.execute(text("""
            WITH global_means AS (
                SELECT AVG(danceability) AS g_d, AVG(energy) AS g_e, AVG(valence) AS g_v
                FROM audio_features
            ),
            genre_means AS (
                SELECT gen.genre_name, AVG(af.danceability) AS d, AVG(af.energy) AS e, AVG(af.valence) AS v
                FROM playlist_tracks pt
                JOIN genres gen ON pt.genre_id = gen.genre_id
                JOIN audio_features af ON pt.track_id = af.track_id
                GROUP BY gen.genre_name
            )
            SELECT gm.genre_name,
                   ROUND(((gm.d - gl.g_d)/NULLIF(gl.g_d,0)*100)::NUMERIC, 1) AS dance_pct_vs_global,
                   ROUND(((gm.e - gl.g_e)/NULLIF(gl.g_e,0)*100)::NUMERIC, 1) AS energy_pct_vs_global,
                   ROUND(((gm.v - gl.g_v)/NULLIF(gl.g_v,0)*100)::NUMERIC, 1) AS valence_pct_vs_global
            FROM genre_means gm CROSS JOIN global_means gl
            ORDER BY gm.genre_name
        """)).fetchall()
        for r in rows:
            print(f"    {r.genre_name:<8}: dance{r.dance_pct_vs_global:+.1f}%  "
                  f"energy{r.energy_pct_vs_global:+.1f}%  valence{r.valence_pct_vs_global:+.1f}%")

        # Window function test
        print("\n  ► Window function test (popularity percentile by genre — sample 3 rows):")
        rows = conn.execute(text("""
            SELECT track_name, genre_name, track_popularity,
                     ROUND((popularity_percentile * 100)::NUMERIC, 1) AS pct_rank
            FROM (
                SELECT t.track_name, g.genre_name, t.track_popularity,
                       PERCENT_RANK() OVER (PARTITION BY g.genre_name ORDER BY t.track_popularity) AS popularity_percentile
                FROM tracks t
                JOIN playlist_tracks pt ON t.track_id = pt.track_id
                JOIN genres g ON pt.genre_id = g.genre_id
            ) ranked
            WHERE popularity_percentile > 0.98
            LIMIT 3
        """)).fetchall()
        for r in rows:
            print(f"    {r.track_name[:30]:<30} | {r.genre_name:<8} | pop={r.track_popularity} | p{r.pct_rank}th")


def main():
    print("=" * 62)
    print("  MusicLens — Database Validation")
    print("=" * 62)

    if not check_connectivity():
        print("\n[ABORT] Cannot connect to database. Check your .env file.\n")
        sys.exit(1)

    engine = get_engine()
    schema_ok  = check_schema(engine)
    counts_ok  = check_row_counts(engine)
    run_analytical_checks(engine)

    print("\n" + "=" * 62)
    if schema_ok and counts_ok:
        print("  ALL CHECKS PASSED ✓  Database is correctly loaded.")
    else:
        print("  SOME CHECKS FAILED — review output above.")
    print("=" * 62 + "\n")


if __name__ == "__main__":
    main()

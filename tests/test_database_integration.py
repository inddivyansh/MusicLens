"""Opt-in PostgreSQL integration checks for the loaded MusicLens warehouse."""

import os

import pytest
from sqlalchemy import inspect, text
from sqlalchemy.exc import SQLAlchemyError

from pipeline.config import DATABASE_URL
from pipeline.utils.db import get_engine


EXPECTED_COUNTS = {
    "genres": 24,
    "artists": 10692,
    "tracks": 28352,
    "audio_features": 28352,
    "playlist_tracks": 32828,
    "genre_stats": 6,
}


@pytest.fixture(scope="module")
def database_engine():
    """Skip cleanly when PostgreSQL is not configured or reachable."""
    if not os.getenv("DATABASE_URL"):
        pytest.skip("DATABASE_URL is not configured")

    engine = get_engine(DATABASE_URL, pooling=False)
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except SQLAlchemyError:
        engine.dispose()
        pytest.skip("PostgreSQL is not reachable")

    yield engine
    engine.dispose()


@pytest.mark.integration
def test_database_objects_exist(database_engine):
    inspector = inspect(database_engine)
    tables = set(inspector.get_table_names(schema="public"))
    views = set(inspector.get_view_names(schema="public"))
    expected_tables = set(EXPECTED_COUNTS) | {"albums", "artist_stats"}
    expected_views = {
        "v_genre_summary",
        "v_artist_leaderboard",
        "v_popularity_buckets",
        "v_top_tracks",
        "v_release_decade_summary",
        "v_genre_audio_profile",
    }

    assert expected_tables <= tables
    assert expected_views <= views

    with database_engine.connect() as connection:
        materialized_view = connection.execute(
            text("SELECT 1 FROM pg_matviews WHERE matviewname = 'track_feature_vectors'")
        ).scalar()
        assert materialized_view == 1


@pytest.mark.integration
def test_database_counts_and_keys_are_valid(database_engine):
    with database_engine.connect() as connection:
        for table, expected_count in EXPECTED_COUNTS.items():
            assert connection.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar() == expected_count

        assert connection.execute(
            text("SELECT COUNT(*) - COUNT(DISTINCT track_id) FROM tracks")
        ).scalar() == 0
        assert connection.execute(
            text("SELECT COUNT(*) - COUNT(DISTINCT track_id) FROM audio_features")
        ).scalar() == 0
        assert connection.execute(
            text("SELECT COUNT(*) - COUNT(DISTINCT track_id) FROM track_feature_vectors")
        ).scalar() == 0

        assert connection.execute(text(
            "SELECT COUNT(*) FROM audio_features af "
            "WHERE NOT EXISTS (SELECT 1 FROM tracks t WHERE t.track_id = af.track_id)"
        )).scalar() == 0
        assert connection.execute(text(
            "SELECT COUNT(*) FROM playlist_tracks pt "
            "WHERE NOT EXISTS (SELECT 1 FROM tracks t WHERE t.track_id = pt.track_id)"
        )).scalar() == 0


@pytest.mark.integration
def test_representative_analytics_execute(database_engine):
    queries = [
        "SELECT genre, unique_tracks FROM v_genre_summary ORDER BY unique_tracks DESC LIMIT 1",
        "SELECT artist_name, DENSE_RANK() OVER (ORDER BY avg_popularity DESC) AS rank "
        "FROM v_artist_leaderboard LIMIT 1",
        "WITH catalog AS (SELECT AVG(track_popularity) AS mean_popularity FROM tracks) "
        "SELECT mean_popularity FROM catalog",
        "SELECT popularity_bucket, track_count FROM v_popularity_buckets",
        "SELECT COUNT(*) FROM v_release_decade_summary",
        "SELECT COUNT(*) FROM track_feature_vectors",
    ]

    with database_engine.connect() as connection:
        for query in queries:
            assert connection.execute(text(query)).first() is not None
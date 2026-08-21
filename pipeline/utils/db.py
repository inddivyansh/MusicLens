"""
Database Utilities
===================
Shared database connection and helper functions for the MusicLens pipeline.
"""

from contextlib import contextmanager
from sqlalchemy import create_engine, text
from pipeline.config import DATABASE_URL


def get_engine(echo: bool = False):
    """
    Create a SQLAlchemy engine connected to the configured database.

    Args:
        echo: If True, log all SQL statements (useful for debugging).

    Returns:
        SQLAlchemy Engine instance.
    """
    return create_engine(
        DATABASE_URL,
        echo=echo,
        pool_pre_ping=True,  # verify connections before use (handles Neon idle)
    )


@contextmanager
def get_connection(echo: bool = False):
    """
    Context manager for a database connection.

    Usage:
        with get_connection() as conn:
            result = conn.execute(text("SELECT 1"))
    """
    engine = get_engine(echo=echo)
    with engine.connect() as conn:
        yield conn


def execute_sql_file(filepath: str, echo: bool = False) -> None:
    """
    Execute a .sql file against the database.

    Args:
        filepath: Path to the SQL file.
        echo: If True, log SQL statements.
    """
    with open(filepath, "r", encoding="utf-8") as f:
        sql_content = f.read()

    engine = get_engine(echo=echo)
    with engine.begin() as conn:
        # Split on semicolons and execute each statement
        for statement in sql_content.split(";"):
            statement = statement.strip()
            if statement:
                conn.execute(text(statement))


def test_connection() -> bool:
    """
    Test the database connection. Returns True if successful.
    """
    try:
        with get_connection() as conn:
            result = conn.execute(text("SELECT 1"))
            return result.scalar() == 1
    except Exception as e:
        print(f"Database connection failed: {e}")
        return False

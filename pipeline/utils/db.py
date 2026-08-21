"""
MusicLens — Database Access Layer (DAL)
========================================
Production-ready database access layer using SQLAlchemy Core.
Supports both local PostgreSQL and cloud-hosted Neon/Supabase.
Credentials are always read from environment variables — never hardcoded.
"""

import sys
import logging
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Generator, List, Optional

from sqlalchemy import (
    create_engine, text, Engine,
    MetaData, Table, inspect
)
from sqlalchemy.pool import NullPool
import re

# Add project root to sys.path if running directly
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from pipeline.config import DATABASE_URL

logger = logging.getLogger(__name__)

_SECRET_URL_RE = re.compile(r"(postgresql(?:\+[\w]+)?://)([^/\s]+)", re.IGNORECASE)


def redact_db_error(exc: Exception) -> str:
    """Strip credentials from database error messages before logging or tests."""
    return _SECRET_URL_RE.sub(r"\1***", str(exc))


def _split_sql_statements(sql_content: str) -> List[str]:
    """Remove full-line comments and split SQL only at semicolons outside strings."""
    lines = ["" if line.lstrip().startswith("--") else line for line in sql_content.splitlines()]
    content = "\n".join(lines)
    statements: List[str] = []
    statement_start = 0
    in_single_quote = False
    index = 0

    while index < len(content):
        char = content[index]
        if char == "'":
            if in_single_quote and index + 1 < len(content) and content[index + 1] == "'":
                index += 2
                continue
            in_single_quote = not in_single_quote
        elif char == ";" and not in_single_quote:
            statement = content[statement_start:index].strip()
            if statement:
                statements.append(statement)
            statement_start = index + 1
        index += 1

    trailing_statement = content[statement_start:].strip()
    if trailing_statement:
        statements.append(trailing_statement)
    return statements


# -----------------------------------------------------------------------
# Engine Factory
# -----------------------------------------------------------------------

def get_engine(
    database_url: Optional[str] = None,
    echo: bool = False,
    pooling: bool = True
) -> Engine:
    """
    Create a SQLAlchemy engine with Neon/Supabase-optimized settings.

    Neon PostgreSQL uses serverless compute that idles between connections.
    pool_pre_ping=True verifies each connection before use, preventing
    "SSL connection has been closed unexpectedly" errors.

    Args:
        database_url: Override DATABASE_URL env var (for testing).
        echo: If True, log all SQL to stdout (debug mode only).
        pooling: If False, use NullPool (useful for scripts/migrations).

    Returns:
        A configured SQLAlchemy Engine.
    """
    url = database_url or DATABASE_URL

    kwargs: dict[str, Any] = {
        "echo": echo,
        "pool_pre_ping": True,
    }

    # NullPool for one-shot scripts (avoids hanging connections)
    if not pooling:
        kwargs["poolclass"] = NullPool

    return create_engine(url, **kwargs)


# -----------------------------------------------------------------------
# Connection Context Manager
# -----------------------------------------------------------------------

@contextmanager
def get_connection(
    database_url: Optional[str] = None,
    echo: bool = False,
) -> Generator:
    """
    Yield a SQLAlchemy connection (auto-commits on exit, rolls back on error).

    Usage:
        with get_connection() as conn:
            result = conn.execute(text("SELECT 1"))
            conn.commit()
    """
    engine = get_engine(database_url=database_url, echo=echo)
    with engine.connect() as conn:
        try:
            yield conn
        except Exception:
            conn.rollback()
            raise
        finally:
            engine.dispose()


# -----------------------------------------------------------------------
# Schema Execution
# -----------------------------------------------------------------------

def execute_schema(schema_path: Optional[Path] = None, echo: bool = False) -> None:
    """
    Execute the full schema.sql file against the configured database.

    SQL line comments are removed before splitting on semicolons. Each
    non-empty statement is executed in a single transaction.

    Args:
        schema_path: Path to schema.sql. Defaults to sql/schema.sql.
        echo: If True, print each executed statement.
    """
    if schema_path is None:
        schema_path = PROJECT_ROOT / "sql" / "schema.sql"

    if not schema_path.exists():
        raise FileNotFoundError(f"Schema file not found: {schema_path}")

    sql_content = schema_path.read_text(encoding="utf-8")
    engine = get_engine(pooling=False, echo=echo)

    with engine.begin() as conn:
        for statement in _split_sql_statements(sql_content):
            conn.execute(text(statement))

    logger.info("Schema applied successfully from %s", schema_path)
    print(f"[DB] Schema applied from: {schema_path}")


def execute_sql_file(filepath: Path, echo: bool = False) -> None:
    """Execute an arbitrary .sql file — useful for running analytical_queries.sql."""
    sql_content = filepath.read_text(encoding="utf-8")
    engine = get_engine(pooling=False, echo=echo)

    with engine.begin() as conn:
        for statement in _split_sql_statements(sql_content):
            conn.execute(text(statement))


# -----------------------------------------------------------------------
# Query Helpers
# -----------------------------------------------------------------------

def fetch_all(sql: str, params: Optional[dict] = None) -> List[dict]:
    """
    Execute a SELECT query and return all rows as list of dicts.

    Args:
        sql: Parameterized SQL string (use :param_name syntax).
        params: Optional dict of parameter values.

    Returns:
        List of rows, each as a dict keyed by column name.
    """
    with get_connection() as conn:
        result = conn.execute(text(sql), params or {})
        return [dict(row._mapping) for row in result]


def fetch_one(sql: str, params: Optional[dict] = None) -> Optional[dict]:
    """Execute a SELECT and return only the first row as a dict."""
    rows = fetch_all(sql, params)
    return rows[0] if rows else None


def fetch_scalar(sql: str, params: Optional[dict] = None) -> Any:
    """Execute a scalar SELECT and return the single value."""
    with get_connection() as conn:
        result = conn.execute(text(sql), params or {})
        return result.scalar()


# -----------------------------------------------------------------------
# Table Utilities
# -----------------------------------------------------------------------

def get_table_counts(engine: Optional[Engine] = None) -> dict[str, int]:
    """
    Return a dict of {table_name: row_count} for all user tables.
    Useful for validation and monitoring.
    """
    if engine is None:
        engine = get_engine()

    inspector = inspect(engine)
    tables = inspector.get_table_names(schema="public")
    counts = {}

    with engine.connect() as conn:
        for table in tables:
            try:
                result = conn.execute(text(f'SELECT COUNT(*) FROM "{table}"'))
                counts[table] = result.scalar()
            except Exception:
                counts[table] = "ERROR"

    return counts


def table_exists(table_name: str, engine: Optional[Engine] = None) -> bool:
    """Check whether a specific table exists in the public schema."""
    if engine is None:
        engine = get_engine()
    inspector = inspect(engine)
    return table_name in inspector.get_table_names(schema="public")


# -----------------------------------------------------------------------
# Connection Test
# -----------------------------------------------------------------------

def test_connection(database_url: Optional[str] = None) -> bool:
    """
    Verify database connectivity. Returns True if successful.

    Uses a simple SELECT 1 to confirm connection and server version.
    """
    try:
        with get_connection(database_url=database_url) as conn:
            row = conn.execute(text("SELECT version()")).scalar()
            logger.info("Database connected: %s", row)
            print(f"[DB] Connected: {row}")
            return True
    except Exception as exc:
        safe = redact_db_error(exc)
        logger.error("Database connection failed: %s", safe)
        print(f"[DB] Connection FAILED: {safe}")
        return False


if __name__ == "__main__":
    test_connection()

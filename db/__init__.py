"""
db — Database backend, auto-selected from the environment.

Set DATABRICKS_HOST to use the Databricks SQL connector (Unity Catalog, OAuth).
Leave it unset to use SQLAlchemy (SQLite / Postgres / MySQL).

All consumer code imports from this package:

    from db import get_schema, run_query, check_connection, IS_DATABRICKS_APP
"""

import os

IS_DATABRICKS_APP: bool = bool(os.environ.get("DATABRICKS_HOST", "").strip())

if IS_DATABRICKS_APP:
    try:
        from .databricks_backend import (  # noqa: F401
            get_schema,
            run_query,
            check_connection,
            connection_summary,
            _connect,
            get_warehouse_display_name,
        )
    except ImportError as exc:
        raise RuntimeError(
            "DATABRICKS_HOST is set but Databricks packages are missing.\n"
            "Install them:  pip install databricks-sql-connector databricks-sdk\n"
            f"{exc}"
        ) from exc
else:
    from .sqlalchemy_backend import get_schema, run_query, check_connection  # noqa: F401

    def connection_summary() -> dict:
        return {}

    _connect = None
    get_warehouse_display_name = None

"""
databricks_backend.py — Databricks-native SQL connector.

Used when DATABRICKS_HOST is set. Supports Unity Catalog (three-part names),
legacy hive_metastore, and multi-scope cross-catalog joins.

Auth flow (auto-detected by the Databricks SDK — no code changes needed):
  Local dev        → DATABRICKS_HOST + DATABRICKS_TOKEN from .env
  Databricks App   → injected OAuth service principal
  CI / service acct → DATABRICKS_CLIENT_ID + DATABRICKS_CLIENT_SECRET
"""

from typing import Any

from databricks import sql as databricks_sql
from databricks.sdk import WorkspaceClient

import config


def _workspace() -> WorkspaceClient:
    return WorkspaceClient()


def resolve_http_path() -> str:
    """
    Return the SQL Warehouse HTTP path.

    Priority:
        1. DATABRICKS_HTTP_PATH env var  — explicit override
        2. Auto-discover the first RUNNING warehouse
        3. Fall back to the first warehouse in any state (triggers cold start)
    """
    if config.DATABRICKS_HTTP_PATH:
        return config.DATABRICKS_HTTP_PATH

    w = _workspace()
    warehouses = list(w.warehouses.list())

    if not warehouses:
        raise RuntimeError(
            "No SQL Warehouses found in this workspace.\n"
            "Create one: SQL → SQL Warehouses → Create warehouse"
        )

    running = [wh for wh in warehouses if str(wh.state) == "State.RUNNING"]
    chosen  = (running or warehouses)[0]
    return f"/sql/1.0/warehouses/{chosen.id}"


def get_warehouse_display_name() -> str:
    """Return a human-readable warehouse label for the UI sidebar."""
    if config.DATABRICKS_HTTP_PATH:
        return config.DATABRICKS_HTTP_PATH.split("/")[-1]
    try:
        w = _workspace()
        warehouses = list(w.warehouses.list())
        running = [wh for wh in warehouses if str(wh.state) == "State.RUNNING"]
        chosen  = (running or warehouses)[0] if warehouses else None
        return f"{chosen.name} ({chosen.cluster_size})" if chosen else "unknown"
    except Exception:
        return "unknown"


def _connect():
    """
    Open an authenticated Databricks SQL connection.

    Returns a context manager: `with _connect() as conn:`
    """
    w     = _workspace()
    host  = (w.config.host or f"https://{config.DATABRICKS_HOST}").removeprefix("https://").removesuffix("/")
    path  = resolve_http_path()
    token = w.config.token or config.DATABRICKS_TOKEN

    kwargs: dict[str, Any] = {
        "server_hostname": host,
        "http_path":       path,
    }

    if token:
        kwargs["access_token"] = token
    else:
        kwargs["credentials_provider"] = lambda: w.config.authenticate

    if config.DATABRICKS_CATALOG:
        kwargs["catalog"] = config.DATABRICKS_CATALOG
    if config.DATABRICKS_SCHEMA:
        kwargs["schema"] = config.DATABRICKS_SCHEMA

    return databricks_sql.connect(**kwargs)


def get_schema() -> dict[str, list[dict[str, str]]]:
    """
    Introspect schemas across all configured scopes.

    Returns:
        Multi-scope (DATABRICKS_SCOPES set): FQN keys "catalog.schema.table"
        Legacy hive_metastore:              bare table-name keys
    """
    if config.DATABRICKS_SCOPES:
        return _get_uc_schema(config.DATABRICKS_SCOPES)
    return _get_hive_schema(config.DATABRICKS_SCHEMA or "default")


def _get_uc_schema(scopes: list[tuple[str, str]]) -> dict[str, list[dict[str, str]]]:
    """Union INFORMATION_SCHEMA.columns across configured (catalog, schema) pairs."""
    result: dict[str, list[dict[str, str]]] = {}
    with _connect() as conn:
        with conn.cursor() as cur:
            for catalog, schema in scopes:
                try:
                    cur.execute(f"""
                        SELECT table_name,
                               column_name,
                               full_data_type
                        FROM   `{catalog}`.information_schema.columns
                        WHERE  table_schema = '{schema}'
                        ORDER  BY table_name, ordinal_position
                    """)
                    for row in cur.fetchall():
                        table_name, col_name, col_type = row[0], row[1], row[2]
                        fqn = f"{catalog}.{schema}.{table_name}"
                        result.setdefault(fqn, []).append(
                            {"name": col_name, "type": col_type}
                        )
                except Exception as exc:
                    print(f"[databricks_backend] could not read {catalog}.{schema}: {exc}")
    return result


def _get_hive_schema(schema: str) -> dict[str, list[dict[str, str]]]:
    """Legacy hive_metastore path. Keys are bare table names."""
    result: dict[str, list[dict[str, str]]] = {}
    with _connect() as conn:
        with conn.cursor() as cur:
            cur.execute(f"SHOW TABLES IN `{schema}`")
            for row in cur.fetchall():
                table_name = row[1] if len(row) >= 2 else row[0]
                try:
                    cur.execute(f"DESCRIBE TABLE `{schema}`.`{table_name}`")
                    result[table_name] = [
                        {"name": r[0], "type": r[1]}
                        for r in cur.fetchall()
                        if r[0] and not str(r[0]).startswith("#")
                    ]
                except Exception:
                    result[table_name] = []
    return result


def run_query(sql: str, limit: int = 100) -> tuple[list[str], list[dict[str, Any]]]:
    """
    Execute a validated SELECT query and return (column_names, rows).

    Wraps the SQL in a LIMIT subquery to guard against unbounded Delta table scans.
    """
    safe_sql = f"SELECT * FROM ({sql.rstrip(';')}) AS _q LIMIT {limit}"

    with _connect() as conn:
        with conn.cursor() as cur:
            cur.execute(safe_sql)
            columns = [desc[0] for desc in cur.description]
            rows    = [dict(zip(columns, row)) for row in cur.fetchall()]

    return columns, rows


def check_connection() -> bool:
    """Ping the SQL Warehouse. Returns True if SELECT 1 succeeds."""
    try:
        with _connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
        return True
    except Exception:
        return False


def connection_summary() -> dict[str, str]:
    """Return key connection details for the UI sidebar."""
    info: dict[str, str] = {
        "host": config.DATABRICKS_HOST or "not set",
    }
    if len(config.DATABRICKS_SCOPES) > 1:
        info["scopes"] = ", ".join(f"{c}.{s}" for c, s in config.DATABRICKS_SCOPES)
    else:
        info["catalog"] = config.DATABRICKS_CATALOG or "—"
        info["schema"]  = config.DATABRICKS_SCHEMA  or "—"
    info["warehouse"] = get_warehouse_display_name()
    return info

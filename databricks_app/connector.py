"""
connector.py — Databricks-native SQL connector.

Teaching notes:

  WHY a separate connector?
    The generic streamlit_app uses SQLAlchemy, which requires a full
    JDBC-style DB_URL. Databricks has its own SQL driver (DB-API 2.0)
    and the Databricks SDK handles all auth — PAT, OAuth M2M, and the
    built-in service principal that Databricks Apps inject automatically.

  Auth flow (auto-detected, no code changes needed):
    Local dev         → SDK reads DATABRICKS_HOST + DATABRICKS_TOKEN from .env
    Databricks App    → SDK reads the app's injected OAuth service principal
    CI / service acct → SDK reads DATABRICKS_CLIENT_ID + DATABRICKS_CLIENT_SECRET

  SQL Warehouse auto-discovery:
    You don't need to know the HTTP path. The SDK lists warehouses in the
    workspace and picks the first running one. Set DATABRICKS_HTTP_PATH
    only if you want to pin a specific warehouse.

  Unity Catalog vs. legacy hive_metastore:
    Unity Catalog (recommended): tables live at catalog.schema.table
      → schema inspection uses INFORMATION_SCHEMA.COLUMNS
    Legacy hive_metastore       : tables live at database.table
      → schema inspection uses SHOW TABLES + DESCRIBE TABLE
    The connector tries Unity Catalog first; falls back automatically.
"""

import os
from typing import Any

from databricks import sql as databricks_sql
from databricks.sdk import WorkspaceClient

import config


# ── WorkspaceClient singleton (one per Streamlit session) ─────────────────────

def _workspace() -> WorkspaceClient:
    """
    Return an authenticated WorkspaceClient.

    Teaching note:
        WorkspaceClient() with no arguments is all you need.
        The SDK resolves auth automatically from the environment:
          - Inside a Databricks App → injected service principal OAuth
          - Local dev → DATABRICKS_HOST + DATABRICKS_TOKEN from .env
        This is called the "unified client interface" in Databricks docs.
    """
    return WorkspaceClient()


# ── SQL Warehouse resolution ──────────────────────────────────────────────────

def resolve_http_path() -> str:
    """
    Return the SQL Warehouse HTTP path.

    Priority:
        1. DATABRICKS_HTTP_PATH env var  — explicit override, useful in CI
        2. Auto-discover the first RUNNING warehouse in the workspace
        3. Fall back to the first warehouse in any state (triggers cold start)

    Teaching note:
        The HTTP path identifies which SQL Warehouse handles your queries.
        Inside a Databricks App you often don't (and shouldn't) hardcode this —
        let the SDK discover it so the app works across workspaces.
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
        return config.DATABRICKS_HTTP_PATH.split("/")[-1]   # just the ID
    try:
        w = _workspace()
        warehouses = list(w.warehouses.list())
        running = [wh for wh in warehouses if str(wh.state) == "State.RUNNING"]
        chosen  = (running or warehouses)[0] if warehouses else None
        return f"{chosen.name} ({chosen.cluster_size})" if chosen else "unknown"
    except Exception:
        return "unknown"


# ── Connection factory ────────────────────────────────────────────────────────

def _connect():
    """
    Open an authenticated Databricks SQL connection.

    Returns a context manager — use as: `with _connect() as conn:`
    Connection closes automatically when the block exits.

    Teaching note:
        We rebuild the connection on each call rather than caching a global.
        This is intentional: Streamlit re-runs on every interaction, and a
        stale connection would raise errors. For high-throughput apps, use a
        connection pool; for a teaching demo, fresh connections are fine.
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
        # PAT auth — works locally and inside Apps when DATABRICKS_TOKEN is set
        kwargs["access_token"] = token
    else:
        # OAuth M2M auth — used when App runs with its own service principal
        # The SDK's config.authenticate returns the right Authorization header
        kwargs["credentials_provider"] = lambda: w.config.authenticate

    if config.DATABRICKS_CATALOG:
        kwargs["catalog"] = config.DATABRICKS_CATALOG
    if config.DATABRICKS_SCHEMA:
        kwargs["schema"] = config.DATABRICKS_SCHEMA

    return databricks_sql.connect(**kwargs)


# ── Schema inspection ─────────────────────────────────────────────────────────

def get_schema() -> dict[str, list[dict[str, str]]]:
    """
    Introspect schemas across all configured scopes.

    Returns:
        Multi-scope (DATABRICKS_SCOPES set, or DATABRICKS_CATALOG+SCHEMA set):
            { "<catalog>.<schema>.<table>": [{"name": col, "type": dtype}, ...], ... }
        Legacy (no scopes set, falls back to hive_metastore):
            { "<table>": [...] }

    Teaching note:
        Multi-scope keys are fully-qualified names so two catalogs can carry
        a `customers` table without collisions, and so the LLM has the FQN it
        needs to qualify joins across stores (the cross-store federation case).
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
                    # One bad scope shouldn't sink the others. Surface it; keep going.
                    print(f"[connector] could not read {catalog}.{schema}: {exc}")
    return result


def _get_hive_schema(schema: str) -> dict[str, list[dict[str, str]]]:
    """Legacy hive_metastore path. Keys are bare table names."""
    result: dict[str, list[dict[str, str]]] = {}
    with _connect() as conn:
        with conn.cursor() as cur:
            cur.execute(f"SHOW TABLES IN `{schema}`")
            # Row format: (databaseName, tableName, isTemporary)
            for row in cur.fetchall():
                table_name = row[1] if len(row) >= 2 else row[0]
                try:
                    cur.execute(f"DESCRIBE TABLE `{schema}`.`{table_name}`")
                    # Lines starting with '#' are partition / metadata headers — skip
                    result[table_name] = [
                        {"name": r[0], "type": r[1]}
                        for r in cur.fetchall()
                        if r[0] and not str(r[0]).startswith("#")
                    ]
                except Exception:
                    result[table_name] = []
    return result


# ── Query execution ───────────────────────────────────────────────────────────

def run_query(sql: str, limit: int = 100) -> tuple[list[str], list[dict[str, Any]]]:
    """
    Execute a validated SELECT query and return (column_names, rows).

    Teaching note:
        The LIMIT wrapper is a safety backstop — Delta tables in production
        can have hundreds of millions of rows. Even a simple SELECT * could
        transfer gigabytes without it. We always enforce the limit at the
        connector layer, not just the prompt layer.
    """
    safe_sql = f"SELECT * FROM ({sql.rstrip(';')}) AS _q LIMIT {limit}"

    with _connect() as conn:
        with conn.cursor() as cur:
            cur.execute(safe_sql)
            columns = [desc[0] for desc in cur.description]
            rows    = [dict(zip(columns, row)) for row in cur.fetchall()]

    return columns, rows


# ── Health check ──────────────────────────────────────────────────────────────

def check_connection() -> bool:
    """Ping the SQL Warehouse. Used by startup banner in app.py."""
    try:
        with _connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
        return True
    except Exception:
        return False


# ── UI helpers ────────────────────────────────────────────────────────────────

def connection_summary() -> dict[str, str]:
    """Return key connection details for display in the UI sidebar."""
    info: dict[str, str] = {
        "host":      config.DATABRICKS_HOST or "not set",
    }
    if len(config.DATABRICKS_SCOPES) > 1:
        info["scopes"] = ", ".join(f"{c}.{s}" for c, s in config.DATABRICKS_SCOPES)
    else:
        info["catalog"] = config.DATABRICKS_CATALOG or "—"
        info["schema"]  = config.DATABRICKS_SCHEMA  or "—"
    info["warehouse"] = get_warehouse_display_name()
    return info

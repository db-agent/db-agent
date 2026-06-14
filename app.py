"""
app.py — The web UI. Entry point for all deployments.

    streamlit run app.py

Set DATABRICKS_HOST to run against Databricks SQL (Unity Catalog, OAuth).
Leave it unset to use SQLAlchemy (SQLite / Postgres / MySQL).
"""

import sys
from pathlib import Path

# Ensure the repo root is on sys.path so `from core.xxx import` and flat
# imports (db, config, pipeline, …) both work regardless of how Streamlit
# launches the script.
sys.path.insert(0, str(Path(__file__).parent))

import pandas as pd
import streamlit as st

import config
from core.models import LLMConfig
from db import IS_DATABRICKS_APP, check_connection, get_schema
from pipeline import run_pipeline

if IS_DATABRICKS_APP:
    from db import _connect, connection_summary  # type: ignore[attr-defined]

# ── Page config ───────────────────────────────────────────────────────────────
_LOGO = Path(__file__).parent / "assets" / "logo.png"

st.set_page_config(
    page_title=config.APP_TITLE,
    page_icon=str(_LOGO) if _LOGO.exists() else ("🧱" if IS_DATABRICKS_APP else "🗄️"),
    layout="wide",
    initial_sidebar_state="expanded",
)

# ── CSS ───────────────────────────────────────────────────────────────────────
st.markdown("""
<style>
.block-container { max-width: 900px; padding-top: 1.5rem; padding-bottom: 4rem; }
.badge {
    display: inline-block; font-size: 0.72rem; font-weight: 600;
    letter-spacing: 0.04em; padding: 0.2rem 0.65rem; border-radius: 999px;
    margin-right: 0.35rem; vertical-align: middle;
}
.badge-databricks { background: #FF3621; color: #fff; }
.badge-blue  { background: #dbeafe; color: #1e40af; }
.badge-green { background: #dcfce7; color: #166534; }
.badge-gray  { background: #f1f5f9; color: #475569; }
.section-label {
    font-size: 0.7rem; font-weight: 700; letter-spacing: 0.08em;
    text-transform: uppercase; color: #9ca3af; margin-bottom: 0.35rem;
}
.question-text {
    font-size: 1.05rem; font-weight: 600; margin-bottom: 0.75rem; color: inherit;
}
</style>
""", unsafe_allow_html=True)


# ── Bootstrap: seed the demo DB (SQLite mode only) ────────────────────────────
if not IS_DATABRICKS_APP:
    from bootstrap import ensure_demo_db_seeded
    db_status = ensure_demo_db_seeded()
else:
    db_status = ""


# ── Session state: seed defaults once per session ─────────────────────────────
for _k, _v in [
    ("history", []),
]:
    if _k not in st.session_state:
        st.session_state[_k] = _v


# ── Sidebar ───────────────────────────────────────────────────────────────────
with st.sidebar:

    if _LOGO.exists():
        st.image(str(_LOGO), width=120)

    if IS_DATABRICKS_APP:
        st.markdown("### DB Agent · Databricks")
        st.caption("Natural-language SQL on your Databricks data")
        st.divider()

        # ── Databricks connection info ─────────────────────────────────────
        st.markdown("**Databricks Connection**")
        _conn_info = connection_summary()
        for _label, _value in _conn_info.items():
            st.markdown(
                f"<div style='margin-bottom:4px'>"
                f"<span style='color:#9ca3af;font-size:0.7rem;text-transform:uppercase'>{_label}</span><br>"
                f"<code style='font-size:0.78rem'>{_value}</code>"
                f"</div>",
                unsafe_allow_html=True,
            )

        with st.spinner("Checking connection…"):
            try:
                with _connect() as _c:
                    with _c.cursor() as _cur:
                        _cur.execute("SELECT 1")
                st.success("SQL Warehouse connected", icon="✅")
            except Exception as _exc:
                st.error("Cannot reach SQL Warehouse", icon="❌")
                st.code(f"{type(_exc).__name__}: {_exc}", language="text")

        st.divider()

    else:
        st.markdown("### DB Agent")
        st.caption("Natural-language SQL · safe & explainable")
        st.divider()

        # ── LLM info (read-only) ───────────────────────────────────────────
        st.markdown("**LLM**")
        for _label, _value in [
            ("Endpoint", config.LLM_BASE_URL or "default"),
            ("Model",    config.LLM_MODEL    or "—"),
        ]:
            st.markdown(
                f"<div style='margin-bottom:4px'>"
                f"<span style='color:#9ca3af;font-size:0.7rem;text-transform:uppercase'>{_label}</span><br>"
                f"<code style='font-size:0.78rem'>{_value}</code>"
                f"</div>",
                unsafe_allow_html=True,
            )
        st.divider()

        # ── Database connection ──────────────────────────────────────────
        st.markdown("**Database**")
        _db_kind = config.DB_URL.split("://")[0] if "://" in config.DB_URL else "unknown"
        st.markdown(
            f"<span style='color:#9ca3af;font-size:0.7rem;text-transform:uppercase'>Driver</span><br>"
            f"<code style='font-size:0.78rem'>{_db_kind}</code>",
            unsafe_allow_html=True,
        )
        if config.IS_SQLITE:
            st.caption(f"Bootstrap: `{db_status}`")
        if check_connection():
            st.success("Database connected", icon="✅")
        else:
            st.error("Database unreachable", icon="❌")
        st.divider()

    # ── Schema browser (both modes) ────────────────────────────────────────
    st.markdown("**Schema**")
    if IS_DATABRICKS_APP:
        if config.DATABRICKS_CATALOG and config.DATABRICKS_SCHEMA:
            st.caption(f"`{config.DATABRICKS_CATALOG}`.`{config.DATABRICKS_SCHEMA}`")
        elif config.DATABRICKS_SCHEMA:
            st.caption(f"`{config.DATABRICKS_SCHEMA}`")

    try:
        _schema = get_schema()
        if _schema:
            for _table, _columns in _schema.items():
                with st.expander(f"{_table}  ({len(_columns)} cols)"):
                    for _col in _columns:
                        st.markdown(
                            f"`{_col['name']}` &nbsp;"
                            f"<span style='color:#9ca3af;font-size:0.8em'>{_col['type']}</span>",
                            unsafe_allow_html=True,
                        )
        else:
            st.caption(
                "No tables found. Check DATABRICKS_CATALOG and DATABRICKS_SCHEMA."
                if IS_DATABRICKS_APP else "No tables found."
            )
    except Exception as _e:
        st.error(f"Schema unavailable: {_e}")

    if not IS_DATABRICKS_APP:
        st.divider()
        st.markdown("**Try an example**")
        for _ex in [
            "How many customers are there?",
            "Show the top 5 products by price",
            "List all orders placed in 2024",
            "Which customers have placed the most orders?",
            "Total revenue per product",
        ]:
            if st.button(_ex, key=f"ex_{_ex}", use_container_width=True):
                st.session_state["pending_question"] = _ex


# ── Header ────────────────────────────────────────────────────────────────────
if IS_DATABRICKS_APP:
    st.markdown(
        "# DB Agent &nbsp;<span style='font-size:1rem;font-weight:400'>· Databricks</span>",
        unsafe_allow_html=True,
    )
    _chain = config.LLM_MODEL_CHAIN
    _model_label = " → ".join(_chain) if len(_chain) > 1 else (_chain[0] if _chain else config.LLM_MODEL)
    _catalog_label = (
        f"{config.DATABRICKS_CATALOG}.{config.DATABRICKS_SCHEMA}"
        if config.DATABRICKS_CATALOG else config.DATABRICKS_SCHEMA or "default"
    )
    _is_dbrx_llm = "serving-endpoints" in (st.session_state.get("llm_base_url") or "")
    _llm_badge = "badge-databricks" if _is_dbrx_llm else "badge-blue"
    st.markdown(
        f"Natural-language SQL on your Delta tables &nbsp;·&nbsp;"
        f"<span class='badge {_llm_badge}'>{_model_label}</span>"
        f"<span class='badge badge-gray'>{_catalog_label}</span>",
        unsafe_allow_html=True,
    )
else:
    st.markdown("# DB Agent")
    _chain = config.LLM_MODEL_CHAIN
    _fallback = st.session_state.get("llm_model") or config.LLM_MODEL or "LLM"
    _model_label = " → ".join(_chain) if len(_chain) > 1 else _fallback
    _db_label = config.DB_URL.split("://")[0] if "://" in config.DB_URL else config.DB_URL
    st.markdown(
        "Safe, explainable natural-language SQL &nbsp;·&nbsp; "
        f"<span class='badge badge-blue'>{_model_label}</span>"
        f"<span class='badge badge-gray'>{_db_label}</span>",
        unsafe_allow_html=True,
    )
st.divider()


# ── Question input ────────────────────────────────────────────────────────────
default_question = st.session_state.pop("pending_question", "")
_placeholder = (
    "Ask a question about your Databricks data …"
    if IS_DATABRICKS_APP else
    "Ask a question about your data …"
)
question = st.chat_input(_placeholder)
active_question = question or default_question


# ── Run pipeline ──────────────────────────────────────────────────────────────
if active_question:
    llm_config = LLMConfig(
        base_url=config.LLM_BASE_URL,
        api_key =config.LLM_API_KEY,
        model   =config.LLM_MODEL,
    )
    with st.spinner("Generating SQL …"):
        output = run_pipeline(active_question, llm_config=llm_config)
    st.session_state["history"].append(output)


# ── Empty state ───────────────────────────────────────────────────────────────
if not st.session_state["history"]:
    if IS_DATABRICKS_APP:
        st.markdown(
            "<div style='text-align:center;padding:2.5rem 0 1rem;color:#9ca3af;'>"
            "<div style='font-size:2.5rem;margin-bottom:0.75rem'>🧱</div>"
            "<div style='font-size:1rem;font-weight:600;margin-bottom:0.4rem;color:#6b7280'>No queries yet</div>"
            "<div style='font-size:0.875rem'>Ask a question above, or try one of these:</div>"
            "</div>",
            unsafe_allow_html=True,
        )
        _examples = [
            "How many rows are in each table?",
            "Show me the 10 most recent records",
            "What are the distinct values in the first column?",
            "Summarize the data with counts and averages",
        ]
        _cols = st.columns(2)
        for _i, _ex in enumerate(_examples):
            if _cols[_i % 2].button(_ex, key=f"dbrx_ex_{_i}", use_container_width=True):
                st.session_state["pending_question"] = _ex
                st.rerun()
    else:
        st.markdown(
            "<div style='text-align:center;padding:4rem 0;color:#9ca3af;'>"
            "<div style='font-size:2.5rem;margin-bottom:0.75rem'>🗄️</div>"
            "<div style='font-size:1rem;font-weight:600;margin-bottom:0.4rem;color:#6b7280'>No queries yet</div>"
            "<div style='font-size:0.875rem'>"
            "Type a question in the box below, or pick an example from the sidebar."
            "</div>"
            "</div>",
            unsafe_allow_html=True,
        )


# ── Result history ────────────────────────────────────────────────────────────
for output in reversed(st.session_state["history"]):
    with st.container(border=True):

        st.markdown("<div class='section-label'>Question</div>", unsafe_allow_html=True)
        st.markdown(f"<div class='question-text'>{output.question}</div>", unsafe_allow_html=True)

        if output.error:
            st.error(f"**Execution error** — {output.error}")
            continue

        if output.sql_response:
            tab_sql, tab_explain, tab_schema = st.tabs(
                ["Generated SQL", "Explanation", "Schema context"]
            )
            with tab_sql:
                st.code(output.sql_response.sql, language="sql")
            with tab_explain:
                st.markdown(output.sql_response.explanation)
            with tab_schema:
                st.code(output.schema_context, language="text")

        if output.validation:
            if output.validation.is_safe:
                st.success(f"Safety check passed — {output.validation.reason}", icon="✅")
            else:
                st.error(f"Safety check failed — {output.validation.reason}", icon="🚫")
                continue

        if output.model_used and len(config.LLM_MODEL_CHAIN) > 1:
            st.caption(f"answered by `{output.model_used}`")

        if output.rows is not None:
            st.markdown("<div class='section-label'>Results</div>", unsafe_allow_html=True)
            if not output.rows:
                st.info("Query executed successfully — no rows returned.")
            else:
                st.caption(f"{len(output.rows)} row{'s' if len(output.rows) != 1 else ''} returned")
                df = pd.DataFrame(output.rows, columns=output.columns)
                st.dataframe(df, use_container_width=True, hide_index=True)

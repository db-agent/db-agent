"""
app.py — Databricks App entry point.

Run locally:
    streamlit run app.py

Deploy to Databricks Apps:
    databricks apps create db-agent
    databricks apps deploy db-agent --source-code-path ./databricks_app

Teaching note:
    This is the same pipeline as the generic streamlit_app, running natively
    inside your Databricks workspace. The UI adds Databricks-specific panels:
      • Connection banner (host / catalog / schema / warehouse)
      • Schema browser showing Unity Catalog hierarchy
      • LLM source badge (Databricks Model Serving vs. external)
"""

import streamlit as st
import pandas as pd

import config
from models import LLMConfig
from pipeline import run_pipeline
from connector import get_schema, connection_summary, _connect

# ── Page config ───────────────────────────────────────────────────────────────
st.set_page_config(
    page_title="DB Agent · Databricks",
    page_icon="🧱",
    layout="wide",
    initial_sidebar_state="expanded",
)

st.markdown("""
<style>
.block-container { max-width: 900px; padding-top: 1.5rem; padding-bottom: 4rem; }

.badge {
    display: inline-block;
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    padding: 0.2rem 0.65rem;
    border-radius: 999px;
    margin-right: 0.35rem;
    vertical-align: middle;
}
.badge-databricks { background: #FF3621; color: #fff; }
.badge-blue   { background: #dbeafe; color: #1e40af; }
.badge-green  { background: #dcfce7; color: #166534; }
.badge-gray   { background: #f1f5f9; color: #475569; }
.badge-orange { background: #ffedd5; color: #9a3412; }

.section-label {
    font-size: 0.7rem; font-weight: 700; letter-spacing: 0.08em;
    text-transform: uppercase; color: #9ca3af; margin-bottom: 0.35rem;
}
.question-text {
    font-size: 1.05rem; font-weight: 600;
    margin-bottom: 0.75rem; color: inherit;
}
.conn-card {
    background: #f8f9fa; border: 1px solid #e9ecef;
    border-radius: 8px; padding: 0.75rem 1rem;
    margin-bottom: 1rem; font-size: 0.8rem;
}
.conn-row { display: flex; gap: 1.5rem; flex-wrap: wrap; }
.conn-item { display: flex; flex-direction: column; }
.conn-label { color: #9ca3af; font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.06em; }
.conn-value { color: #1e293b; font-weight: 600; font-family: monospace; }
</style>
""", unsafe_allow_html=True)

# ── Session state: seed LLM config from env once ──────────────────────────────
if "llm_base_url" not in st.session_state:
    st.session_state["llm_base_url"] = config.LLM_BASE_URL
if "llm_api_key" not in st.session_state:
    st.session_state["llm_api_key"] = config.LLM_API_KEY
if "llm_model" not in st.session_state:
    st.session_state["llm_model"] = config.LLM_MODEL
if "history" not in st.session_state:
    st.session_state["history"] = []

# ── Sidebar ───────────────────────────────────────────────────────────────────
with st.sidebar:
    st.markdown("### 🧱 DB Agent · Databricks")
    st.caption("Natural-language SQL on your Databricks data")
    st.divider()

    # ── Databricks connection info ─────────────────────────────────────────
    st.markdown("**Databricks Connection**")
    conn = connection_summary()
    for label, value in conn.items():
        st.markdown(
            f"<div style='margin-bottom:4px'>"
            f"<span style='color:#9ca3af;font-size:0.7rem;text-transform:uppercase'>{label}</span><br>"
            f"<code style='font-size:0.78rem'>{value}</code>"
            f"</div>",
            unsafe_allow_html=True,
        )

    # Connection health indicator
    with st.spinner("Checking connection…"):
        try:
            with _connect() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT 1")
            st.success("SQL Warehouse connected", icon="✅")
        except Exception as exc:
            st.error("Cannot reach SQL Warehouse", icon="❌")
            st.code(f"{type(exc).__name__}: {exc}", language="text")

    # Debug panel — verify env vars arrived at runtime
    import os as _os
    with st.expander("🔧 Debug: runtime env"):
        key_raw = _os.environ.get("LLM_API_KEY", "")
        st.write({
            "LLM_BASE_URL":     _os.environ.get("LLM_BASE_URL", ""),
            "LLM_MODEL":        _os.environ.get("LLM_MODEL", ""),
            "LLM_API_KEY_len":  len(key_raw),
            "LLM_API_KEY_head": key_raw[:4] if key_raw else "(empty)",
            "LLM_API_KEY_tail": key_raw[-4:] if key_raw else "(empty)",
            "has_whitespace":   key_raw != key_raw.strip(),
        })

    st.divider()

    # ── Schema browser ─────────────────────────────────────────────────────
    st.markdown("**Schema Browser**")
    catalog = config.DATABRICKS_CATALOG
    schema  = config.DATABRICKS_SCHEMA
    if catalog and schema:
        st.caption(f"`{catalog}`.`{schema}`")
    elif schema:
        st.caption(f"`{schema}`")

    try:
        schema_data = get_schema()
        if schema_data:
            for table, columns in schema_data.items():
                with st.expander(f"{table}  ({len(columns)} cols)"):
                    for col in columns:
                        st.markdown(
                            f"`{col['name']}` &nbsp;"
                            f"<span style='color:#9ca3af;font-size:0.8em'>{col['type']}</span>",
                            unsafe_allow_html=True,
                        )
        else:
            st.caption("No tables found. Check DATABRICKS_CATALOG and DATABRICKS_SCHEMA.")
    except Exception as e:
        st.error(f"Schema unavailable: {e}")

# ── Header ────────────────────────────────────────────────────────────────────
st.markdown("# DB Agent &nbsp;<span style='font-size:1rem;font-weight:400'>· Databricks</span>", unsafe_allow_html=True)

model_label = st.session_state.get("llm_model") or config.LLM_MODEL or "LLM"
host_label  = config.DATABRICKS_HOST or "not connected"
catalog_label = f"{config.DATABRICKS_CATALOG}.{config.DATABRICKS_SCHEMA}" if config.DATABRICKS_CATALOG else config.DATABRICKS_SCHEMA or "default"

is_dbrx_llm = "serving-endpoints" in (st.session_state.get("llm_base_url") or "")
llm_badge_class = "badge-databricks" if is_dbrx_llm else "badge-blue"

st.markdown(
    f"Natural-language SQL on your Delta tables &nbsp;·&nbsp;"
    f"<span class='badge {llm_badge_class}'>{model_label}</span>"
    f"<span class='badge badge-gray'>{catalog_label}</span>",
    unsafe_allow_html=True,
)
st.divider()

# ── Question input ────────────────────────────────────────────────────────────
default_question = st.session_state.pop("pending_question", "")
question = st.chat_input("Ask a question about your Databricks data …")
active_question = question or default_question

# ── Run pipeline ──────────────────────────────────────────────────────────────
if active_question:
    llm_config = LLMConfig(
        base_url=st.session_state.get("llm_base_url", config.LLM_BASE_URL),
        api_key =st.session_state.get("llm_api_key",  config.LLM_API_KEY),
        model   =st.session_state.get("llm_model",    config.LLM_MODEL),
    )
    with st.spinner("Generating SQL …"):
        output = run_pipeline(active_question, llm_config=llm_config)
    st.session_state["history"].append(output)

# ── Empty state with clickable examples ──────────────────────────────────────
if not st.session_state["history"]:
    st.markdown(
        "<div style='text-align:center;padding:2.5rem 0 1rem;color:#9ca3af;'>"
        "<div style='font-size:2.5rem;margin-bottom:0.75rem'>🧱</div>"
        "<div style='font-size:1rem;font-weight:600;margin-bottom:0.4rem;color:#6b7280'>No queries yet</div>"
        "<div style='font-size:0.875rem'>Ask a question above, or try one of these:</div>"
        "</div>",
        unsafe_allow_html=True,
    )

    examples = [
        "How many rows are in each table?",
        "Show me the 10 most recent records",
        "What are the distinct values in the first column?",
        "Summarize the data with counts and averages",
        "Show the schema of all tables",
    ]
    cols = st.columns(2)
    for i, ex in enumerate(examples):
        if cols[i % 2].button(ex, key=f"ex_{i}", use_container_width=True):
            st.session_state["pending_question"] = ex
            st.rerun()

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

        if output.rows is not None:
            st.markdown("<div class='section-label'>Results</div>", unsafe_allow_html=True)
            if not output.rows:
                st.info("Query executed successfully — no rows returned.")
            else:
                st.caption(f"{len(output.rows)} row{'s' if len(output.rows) != 1 else ''} returned")
                df = pd.DataFrame(output.rows, columns=output.columns)
                st.dataframe(df, use_container_width=True, hide_index=True)

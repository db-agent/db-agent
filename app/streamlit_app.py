"""
streamlit_app.py — The web UI. Run with: streamlit run app/streamlit_app.py

Teaching note:
    Streamlit re-runs this entire file on every user interaction.
    We keep state (chat history) in st.session_state so it survives reruns.
    The UI is intentionally simple — every panel maps to one pipeline stage.
"""

import sys
from pathlib import Path

# Streamlit adds the script's own directory (app/) to sys.path, not the project
# root — so `from app.config import ...` would fail without this line.
sys.path.insert(0, str(Path(__file__).parent.parent))

import streamlit as st
import pandas as pd
from app.config import APP_TITLE, LLM_BASE_URL, LLM_API_KEY, LLM_MODEL, DB_URL
from app.models import LLMConfig
from app.pipeline import run_pipeline
from app.db import get_schema

# ── Page config ───────────────────────────────────────────────────────────────
st.set_page_config(
    page_title="DB Agent",
    page_icon="🗄️",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ── CSS polish ────────────────────────────────────────────────────────────────
st.markdown("""
<style>
/* Readable content width */
.block-container {
    max-width: 860px;
    padding-top: 2rem;
    padding-bottom: 4rem;
}

/* Status badges */
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
.badge-blue { background: #dbeafe; color: #1e40af; }
.badge-gray { background: #f1f5f9; color: #475569; }

/* Small uppercase section label */
.section-label {
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #9ca3af;
    margin-bottom: 0.35rem;
}

/* Question text inside a result card */
.question-text {
    font-size: 1.05rem;
    font-weight: 600;
    margin-bottom: 0.75rem;
    color: inherit;
}
</style>
""", unsafe_allow_html=True)

# ── Session state: seed from env once ────────────────────────────────────────
if "llm_base_url" not in st.session_state:
    st.session_state["llm_base_url"] = LLM_BASE_URL
if "llm_api_key" not in st.session_state:
    st.session_state["llm_api_key"] = LLM_API_KEY
if "llm_model" not in st.session_state:
    st.session_state["llm_model"] = LLM_MODEL
if "history" not in st.session_state:
    st.session_state["history"] = []

# ── Sidebar ───────────────────────────────────────────────────────────────────
with st.sidebar:
    st.markdown("### DB Agent")
    st.caption("Natural-language SQL · safe & explainable")
    st.divider()

    st.markdown("**LLM Settings**")
    st.text_input(
        "API endpoint",
        placeholder="https://api.openai.com/v1",
        help="Any OpenAI-compatible base URL — OpenAI, Ollama, Groq, LM Studio",
        key="llm_base_url",
    )
    st.text_input(
        "API key",
        type="password",
        placeholder="sk-…  (leave blank for Ollama)",
        key="llm_api_key",
    )
    st.text_input(
        "Model",
        placeholder="gpt-4o-mini",
        key="llm_model",
    )
    st.divider()

    st.markdown("**Database**")
    st.caption(f"`{DB_URL}`")
    st.divider()

    st.markdown("**Schema**")
    try:
        schema = get_schema()
        if schema:
            for table, columns in schema.items():
                with st.expander(f"{table}  ({len(columns)} cols)"):
                    for col in columns:
                        st.markdown(
                            f"`{col['name']}` &nbsp;"
                            f"<span style='color:#9ca3af;font-size:0.8em'>{col['type']}</span>",
                            unsafe_allow_html=True,
                        )
        else:
            st.caption("No tables found.")
    except Exception as e:
        st.error(f"Schema unavailable: {e}")
    st.divider()

    st.markdown("**Try an example**")
    examples = [
        "How many customers are there?",
        "Show the top 5 products by price",
        "List all orders placed in 2024",
        "Which customers have placed the most orders?",
        "Total revenue per product",
    ]
    for ex in examples:
        if st.button(ex, key=f"ex_{ex}", use_container_width=True):
            st.session_state["pending_question"] = ex

# ── Header ────────────────────────────────────────────────────────────────────
st.markdown("# DB Agent")
_model_label = st.session_state.get("llm_model") or LLM_MODEL or "LLM"
_db_label = DB_URL.split("://")[0] if "://" in DB_URL else DB_URL
st.markdown(
    "Safe, explainable natural-language SQL &nbsp;·&nbsp; "
    f"<span class='badge badge-blue'>{_model_label}</span>"
    f"<span class='badge badge-gray'>{_db_label}</span>",
    unsafe_allow_html=True,
)
st.divider()

# ── Question input ────────────────────────────────────────────────────────────
default_question = st.session_state.pop("pending_question", "")
question = st.chat_input("Ask a question about your data …")
active_question = question or default_question

# ── Run pipeline ──────────────────────────────────────────────────────────────
if active_question:
    llm_config = LLMConfig(
        base_url=st.session_state.get("llm_base_url", LLM_BASE_URL),
        api_key=st.session_state.get("llm_api_key", LLM_API_KEY),
        model=st.session_state.get("llm_model", LLM_MODEL),
    )
    with st.spinner("Generating SQL …"):
        output = run_pipeline(active_question, llm_config=llm_config)
    st.session_state["history"].append(output)

# ── Empty state ───────────────────────────────────────────────────────────────
if not st.session_state["history"]:
    st.markdown(
        "<div style='text-align:center;padding:4rem 0;color:#9ca3af;'>"
        "<div style='font-size:2.5rem;margin-bottom:0.75rem'>🗄️</div>"
        "<div style='font-size:1rem;font-weight:600;margin-bottom:0.4rem;color:#6b7280'>No queries yet</div>"
        "<div style='font-size:0.875rem'>Type a question in the box below, or pick an example from the sidebar.</div>"
        "</div>",
        unsafe_allow_html=True,
    )

# ── Result history ────────────────────────────────────────────────────────────
for output in reversed(st.session_state["history"]):
    with st.container(border=True):

        # Question heading
        st.markdown("<div class='section-label'>Question</div>", unsafe_allow_html=True)
        st.markdown(f"<div class='question-text'>{output.question}</div>", unsafe_allow_html=True)

        # Hard error (pipeline-level failure)
        if output.error:
            st.error(f"**Execution error** — {output.error}")
            continue

        # SQL · Explanation · Schema context as tabs
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

        # Validation status
        if output.validation:
            if output.validation.is_safe:
                st.success(f"Safety check passed — {output.validation.reason}", icon="✅")
            else:
                st.error(f"Safety check failed — {output.validation.reason}", icon="🚫")
                continue  # blocked query: don't show a (nonexistent) result table

        # Results table
        if output.rows is not None:
            st.markdown("<div class='section-label'>Results</div>", unsafe_allow_html=True)
            if len(output.rows) == 0:
                st.info("Query executed successfully — no rows returned.")
            else:
                row_count = len(output.rows)
                st.caption(f"{row_count} row{'s' if row_count != 1 else ''} returned")
                df = pd.DataFrame(output.rows, columns=output.columns)
                st.dataframe(df, use_container_width=True, hide_index=True)

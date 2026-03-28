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
st.set_page_config(page_title=APP_TITLE, page_icon="🗄️", layout="wide")
st.title(f"🗄️ {APP_TITLE}")
st.caption("Ask questions about your database in plain English.")

# ── Sidebar: configuration ────────────────────────────────────────────────────
# Seed session state from env on first load only
if "llm_base_url" not in st.session_state:
    st.session_state["llm_base_url"] = LLM_BASE_URL
if "llm_api_key" not in st.session_state:
    st.session_state["llm_api_key"] = LLM_API_KEY
if "llm_model" not in st.session_state:
    st.session_state["llm_model"] = LLM_MODEL

with st.sidebar:
    st.header("⚙️ LLM Configuration")

    st.text_input(
        "API endpoint",
        placeholder="https://api.openai.com/v1",
        help="Any OpenAI-compatible base URL (OpenAI, Ollama, Groq, LM Studio …)",
        key="llm_base_url",
    )
    st.text_input(
        "API key",
        type="password",
        placeholder="sk-…  (leave blank for Ollama)",
        key="llm_api_key",
    )
    st.text_input(
        "Model name",
        placeholder="gpt-4o-mini",
        key="llm_model",
    )

    st.caption(f"DB: `{DB_URL}`")

    st.header("📋 Schema")
    try:
        schema = get_schema()
        for table, columns in schema.items():
            with st.expander(f"📁 {table}"):
                for col in columns:
                    st.markdown(f"- `{col['name']}` — {col['type']}")
    except Exception as e:
        st.error(f"Could not load schema: {e}")

    st.header("💡 Example queries")
    examples = [
        "How many customers are there?",
        "Show the top 5 products by price",
        "List all orders placed in 2024",
        "Which customers have placed the most orders?",
        "What is the total revenue per product?",
    ]
    for ex in examples:
        if st.button(ex, key=ex, use_container_width=True):
            st.session_state["pending_question"] = ex

# ── Chat history ──────────────────────────────────────────────────────────────
if "history" not in st.session_state:
    st.session_state["history"] = []

# ── Question input ────────────────────────────────────────────────────────────
# Pre-fill if an example button was clicked
default_question = st.session_state.pop("pending_question", "")
question = st.chat_input("Ask a question about your data …")

# Allow both sidebar examples and direct chat input
active_question = question or default_question

# ── Process question ──────────────────────────────────────────────────────────
if active_question:
    llm_config = LLMConfig(
        base_url=st.session_state.get("llm_base_url", LLM_BASE_URL),
        api_key=st.session_state.get("llm_api_key", LLM_API_KEY),
        model=st.session_state.get("llm_model", LLM_MODEL),
    )
    with st.spinner("Thinking …"):
        output = run_pipeline(active_question, llm_config=llm_config)
    st.session_state["history"].append(output)

# ── Display history ───────────────────────────────────────────────────────────
for output in reversed(st.session_state["history"]):
    st.divider()

    # Question
    st.markdown(f"### 💬 {output.question}")

    # Explainability panels (collapsed by default to keep UI clean)
    col1, col2 = st.columns(2)

    with col1:
        with st.expander("📐 Schema context sent to LLM"):
            st.code(output.schema_context, language="text")

    with col2:
        if output.sql_response:
            with st.expander("🤖 LLM explanation"):
                st.markdown(output.sql_response.explanation)

    # Generated SQL
    if output.sql_response and output.sql_response.sql:
        st.markdown("**Generated SQL**")
        st.code(output.sql_response.sql, language="sql")

    # Validation result
    if output.validation:
        if output.validation.is_safe:
            st.success(f"✅ Safety check passed: {output.validation.reason}")
        else:
            st.error(f"🚫 Safety check failed: {output.validation.reason}")

    # Results
    if output.error:
        st.error(f"❌ Error: {output.error}")
    elif output.rows is not None:
        if len(output.rows) == 0:
            st.info("Query returned no rows.")
        else:
            st.markdown(f"**Results** — {len(output.rows)} row(s)")
            df = pd.DataFrame(output.rows, columns=output.columns)
            st.dataframe(df, use_container_width=True)

# DB Agent · Streamlit App

A natural-language SQL agent that runs anywhere Python runs — local laptop,
Docker, Kubernetes, Streamlit Community Cloud, or **Databricks Apps**.

Set `DATABRICKS_HOST` to connect to Databricks SQL (Unity Catalog, OAuth).
Leave it unset for generic SQLAlchemy mode (SQLite / Postgres / MySQL).

---

## Architecture

```
streamlit_app.py     Streamlit UI — adapts sidebar and header to active backend
  │
  ├── pipeline.py    Thin wrapper — binds db + prompts to core/pipeline.py
  │     ├── prompts.py          System prompt + schema builder (backend-aware)
  │     └── db/                 Database backend package
  │           ├── __init__.py         Auto-selects backend from DATABRICKS_HOST
  │           ├── sqlalchemy_backend.py   SQLite / Postgres / MySQL via SQLAlchemy
  │           └── databricks_backend.py   Databricks SQL + Unity Catalog + OAuth
  │
  ├── config.py      Unified env config — st.secrets / env / .env / defaults
  ├── bootstrap.py   Auto-seeds the demo SQLite DB on first boot (SQLite only)
  │
  └── core/          Shared logic (lives at the project root)
        ├── pipeline.py    Orchestrates the end-to-end flow (start reading here)
        ├── llm.py         Calls any OpenAI-compatible LLM endpoint
        ├── sql_safety.py  Whitelists SELECT-only SQL before execution
        └── models.py      Pydantic contracts (LLMConfig, SQLResponse, …)
```

The pipeline never raises — every failure populates `PipelineOutput.error`
so the UI can render a friendly message instead of a stack trace.

---

## Local dev (generic SQLite mode)

```bash
# From the repo root
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
# Edit .env — add LLM_API_KEY at minimum

streamlit run streamlit_app/streamlit_app.py
```

The demo SQLite database is created automatically on first boot (`bootstrap.py`).

---

## Local dev (Databricks mode)

```bash
pip install -r requirements.txt   # includes databricks-sql-connector + databricks-sdk

# .env
DATABRICKS_HOST=adb-xxxx.azuredatabricks.net
DATABRICKS_TOKEN=dapi...
DATABRICKS_CATALOG=main
DATABRICKS_SCHEMA=default
# Optional — leave blank to auto-discover SQL Warehouse
DATABRICKS_HTTP_PATH=

streamlit run streamlit_app/streamlit_app.py
```

The sidebar shows a Databricks connection banner and warehouse info.
The SQL safety layer adds `OPTIMIZE / VACUUM / ZORDER / COPY` to the blocklist.

---

## Deploy to Streamlit Community Cloud

1. Push this repo to GitHub.
2. Sign in at [share.streamlit.io](https://share.streamlit.io) → **New app**.
3. Set **Main file path** to `streamlit_app/streamlit_app.py`.
4. Open **Advanced settings → Secrets** and paste LLM credentials:

   ```toml
   LLM_BASE_URL = "https://api.openai.com/v1"
   LLM_API_KEY  = "sk-..."
   LLM_MODEL    = "gpt-4o-mini"
   ```

---

## Deploy to Databricks Apps

Edit [`../app.yaml`](../app.yaml) with your workspace values, then:

```bash
# Deploy the full repo root (core/ package must be included)
databricks apps create db-agent --description "Natural-language SQL agent"
databricks apps deploy db-agent --source-code-path .
```

Grant the app's service principal `CAN_USE` on the warehouse and `SELECT`
on the catalog/schema. See the Databricks grant SQL in the troubleshooting
section below.

---

## Backend switching

| Env var | Effect |
|---|---|
| `DATABRICKS_HOST` unset | SQLAlchemy backend — set `DB_URL` to any SQLAlchemy-compatible URL |
| `DATABRICKS_HOST` set | Databricks backend — set catalog/schema/warehouse as needed |

```toml
# Generic Postgres
DB_URL = "postgresql+psycopg2://user:password@host:5432/mydb"

# Databricks
DATABRICKS_HOST   = "adb-xxxx.azuredatabricks.net"
DATABRICKS_CATALOG = "main"
DATABRICKS_SCHEMA  = "default"
```

---

## Testing

```bash
pytest tests/ -v
```

Tests monkeypatch `db.sqlalchemy_backend._engine` with an in-memory SQLite
engine and stub `core.pipeline.call_llm` — no external connections made.

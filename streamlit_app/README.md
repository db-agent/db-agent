# DB Agent · Streamlit App

A natural-language SQL agent that runs anywhere Python runs — local laptop,
Docker, or **Streamlit Community Cloud** with zero infrastructure.

This is the generic, batteries-included version of DB Agent. For the
Databricks-native variant (Unity Catalog, OAuth service principals, Model
Serving) see [`../databricks_app/`](../databricks_app/).

---

## Architecture

```
streamlit_app.py     Streamlit UI — sidebar, schema browser, result panels
  │
  ├── pipeline.py    Orchestrates the end-to-end flow (start reading here)
  │     ├── prompts.py     Builds schema-aware system + user prompts
  │     ├── llm.py         Calls any OpenAI-compatible LLM endpoint
  │     ├── sql_safety.py  Whitelists SELECT-only SQL before execution
  │     └── db.py          SQLAlchemy connection, schema reflection, exec
  │
  ├── config.py      st.secrets → env → .env → defaults resolution
  ├── bootstrap.py   Auto-seeds the demo SQLite DB on first boot
  └── models.py      Pydantic contracts (LLMConfig, SQLResponse, …)
```

The pipeline never raises — every failure populates `PipelineOutput.error`
so the UI can render a friendly message instead of a stack trace.

---

## Local dev

```bash
# From the repo root
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
# Edit .env — add LLM_API_KEY at minimum

streamlit run streamlit_app/streamlit_app.py
```

The demo SQLite database is created automatically the first time the app
boots — see `bootstrap.py`.

---

## Deploy to Streamlit Community Cloud

1. **Push this repo to GitHub** (Community Cloud reads from a GitHub repo).

2. **Sign in** at [share.streamlit.io](https://share.streamlit.io) and click
   **New app**.

3. Fill in the deploy form:

   | Field | Value |
   |---|---|
   | Repository | `<your-org>/db-agent` |
   | Branch | `main` |
   | **Main file path** | `streamlit_app/streamlit_app.py` |
   | Python version | 3.11 (matches `runtime.txt`) |

4. Open **Advanced settings → Secrets** and paste the LLM credentials.
   Use [`.streamlit/secrets.toml.example`](../.streamlit/secrets.toml.example)
   as a template:

   ```toml
   LLM_BASE_URL = "https://api.openai.com/v1"
   LLM_API_KEY  = "sk-..."
   LLM_MODEL    = "gpt-4o-mini"
   ```

5. Click **Deploy**. First boot takes ~60 seconds — the auto-seeder writes
   the demo SQLite DB to the container's ephemeral filesystem.

That's it. To use a different LLM provider or a hosted Postgres later, just
edit the secrets — no code change, no redeploy.

---

## How it handles Cloud's quirks

| Quirk | How this app handles it |
|---|---|
| Filesystem is ephemeral on every cold start | `bootstrap.ensure_demo_db_seeded()` re-creates the SQLite demo DB on first boot, cached with `@st.cache_resource` |
| Secrets aren't exposed as env vars | `config._secret()` reads `st.secrets` first, then `os.environ`, then `.env`, then defaults |
| Only the entry script's directory is on `sys.path` | All modules use flat imports (`import db`, `from models import …`); the entry script adds its own directory to `sys.path` explicitly so the same code runs under pytest, `python -m streamlit run`, and Cloud |
| No persistent storage for user data | History is kept in `st.session_state` and lives only as long as the browser tab |

---

## Testing

```bash
pytest tests/ -v
```

Tests live in [`../tests/`](../tests/) and never touch the demo database —
they monkeypatch `db._engine` with an in-memory SQLite engine, and stub
`call_llm()` so no API calls happen. See [`tests/conftest.py`](../tests/conftest.py)
for the `sys.path` bridge.

---

## Switching databases

Set `DB_URL` in secrets / `.env` to anything SQLAlchemy understands:

```toml
# Postgres
DB_URL = "postgresql+psycopg2://user:password@host:5432/mydb"

# MySQL
DB_URL = "mysql+pymysql://user:password@host:3306/mydb"
```

Add the matching driver to `requirements.txt` (`psycopg2-binary` or
`PyMySQL`). The auto-seeder is a no-op for non-SQLite URLs — your existing
schema is left alone.

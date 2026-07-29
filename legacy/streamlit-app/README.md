# DB Agent (Streamlit) — archived

This is the original Python/Streamlit implementation of DB Agent. It has been
superseded by the Node.js/React app at [`app/`](../../app),
which is now the primary implementation. This folder is kept for reference
— the code still runs, but new features and fixes land in `app/` only.

## Run it locally

```bash
cd legacy/streamlit-app
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # defaults to SQLite + OpenAI-compatible LLM
streamlit run app.py
```

Or, for local Ollama with no API key:

```bash
ollama pull qwen2.5-coder:7b
./run_local.sh
```

## What's here

- `app.py` / `pipeline.py` / `prompts.py` / `config.py` / `bootstrap.py` — the app
- `core/` — backend-agnostic pipeline (LLM call, SQL safety, orchestration)
- `db/` — SQLAlchemy and Databricks SQL backends
- `data/` — demo SQLite DB + seed/loader scripts
- `tests/` — pytest suite (36 tests, still passing from this location)
- `deploy/k8s/`, `infra/terraform/` — Kubernetes + Terraform for the EKS deployment path
- `.streamlit/`, `Dockerfile`, `app.yaml`, `.databricksignore` — deployment configs for
  Streamlit Cloud, Docker/EKS, and Databricks Apps respectively

## CI/CD

The GitHub Actions workflows that build/deploy this app still exist, prefixed
`legacy-` in `.github/workflows/`, with paths updated to point here. They're
manual-trigger only (`workflow_dispatch`) — re-verify before running, since
this app is no longer actively maintained.

# DB Agent (Node)

A Node.js/Express prototype of the same text-to-SQL agent as the root
Streamlit app — built to compare how the UI feels on a real frontend stack
(React + Tailwind + shadcn/ui) versus Streamlit's rerun-on-every-interaction
model and widget styling. See the root `README.md` for background on the
project.

Scope is intentionally narrower than the Python app in one respect: SQLite
only, a single LLM (no model failover chain, no Databricks-native SQL
backend). It does carry over the SQL repair-on-failure loop and the
cross-platform contextual memory feature — see Notes below.

Two parts:
- `server.js` / `memory.js` — Express API (`/api/schema`, `/api/config`,
  `/api/ask`, `/api/memories`), also serves the built frontend
- `web/` — React + Vite + Tailwind v4 + shadcn/ui frontend

## Run it

**Quick start with local Ollama** (mirrors `../run_local.sh`):

```bash
ollama pull qwen2.5-coder:7b   # or any model you prefer
cd nodejs-app
./run_local.sh
```

Checks Ollama is installed, the model is pulled, and the server is reachable
before starting — same preflight checks as the Streamlit app's
`run_local.sh`. Builds the frontend automatically on first run if `web/dist`
doesn't exist yet. Pass a different model as `$1`:
`./run_local.sh llama3.2`.

**Manual setup** (any OpenAI-compatible endpoint):

```bash
cd nodejs-app
npm install
cp .env.example .env      # defaults to local Ollama; edit for OpenAI/Groq/etc.

npm run build              # builds web/dist
npm start
```

Open http://localhost:3001. Default `DB_PATH` is the self-contained
`./data/demo.db` bundled in this directory (so the app has no path
dependency outside its own source tree — required for Databricks Apps,
which deploys `nodejs-app/` as an isolated source root). To instead share
the root Python app's seeded DB during local dev, set
`DB_PATH=../data/demo.db` (run the Python app once first, or
`python ../bootstrap.py`, if that file doesn't exist yet).

**Frontend dev mode** (hot reload, instead of building): run `npm run dev` in
`web/` (http://localhost:5173) with `server.js` running separately — Vite
proxies `/api/*` to `http://localhost:3001` (see `web/vite.config.ts`).

## Databricks Apps

This still fits the Databricks Apps Node.js runtime (React + Express are both
documented-supported) — the deployment shape is the same generic
"process bound to a port," just with one extra build step
(`npm run build` in `web/`) before `npm start`.

## Notes

- Uses Node's built-in `node:sqlite` module (stable in Node ≥ 22.5) — no
  native build step, unlike `better-sqlite3`.
- Mirrors `../core/sql_safety.py`'s safety rules and `../core/pipeline.py`'s
  SQL repair-on-failure loop (failed execution → error fed back to the LLM →
  re-validated before retrying) — same behavior, ported by hand since this is
  a separate runtime, not a shared library.
- **Cross-platform contextual memory** (`memory.js`, ported from
  `../core/memory.py`): after each answered question, a second LLM call
  produces a redacted summary (never raw SQL/rows) written to a local JSONL
  store (`data/memory_store.jsonl`, gitignored). Other `DBAGENT_ID` instances
  pointed at the same store surface it as "Suggested from other agents" in
  the sidebar. Set `DBAGENT_ID` per instance (`run_local.sh` supports
  `DBAGENT_ID=oltp-sqlserver ./run_local.sh`, same as the Python app). Only
  the local JSONL backend is ported — the S3 Vectors backend
  (`core/memory.py`'s `S3VectorsBackend`) is intentionally not, since it's
  still unverified against real AWS even on the Python side (repo issues
  #26–#30).
- No streaming, no auth — this is a UI comparison prototype, not a
  production alternative to the Streamlit app.

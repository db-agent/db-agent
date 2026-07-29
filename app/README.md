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
cd app
./run_local.sh
```

Checks Ollama is installed, the model is pulled, and the server is reachable
before starting — same preflight checks as the Streamlit app's
`run_local.sh`. Builds the frontend automatically on first run if `web/dist`
doesn't exist yet. Pass a different model as `$1`:
`./run_local.sh llama3.2`.

**Manual setup** (any OpenAI-compatible endpoint):

```bash
cd app
npm install
cp .env.example .env      # defaults to local Ollama; edit for OpenAI/Groq/etc.

npm run build              # builds web/dist
npm start
```

Open http://localhost:3001. Default `DB_PATH` is the self-contained
`./data/demo.db` bundled in this directory (so the app has no path
dependency outside its own source tree — required for Databricks Apps,
which deploys `app/` as an isolated source root). To instead share
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
- **Optional knowledge file** (`knowledge.js`, `knowledge.json`): the schema
  alone (table/column names + types) doesn't carry business terminology,
  ambiguous-column meaning, or house rules — this is where those go. Copy
  `knowledge.json.example` to `knowledge.json` (gitignored, per-deployment,
  same pattern as `.env`) to add:
  - **descriptions** — column/table notes and synonyms
  - **expressions** — reusable metric definitions (e.g. `revenue = SUM(quantity * price)`)
  - **examples** — question → correct SQL pairs (few-shot; small local models
    benefit disproportionately from these)
  - **instructions** — free-text rules applied to every query

  Read fresh on every request, not cached at startup, so edits take effect
  immediately — this is meant to be iterated on, not configured once.
  Missing file = zero change to current behavior. Verified: the same
  ambiguous question ("What is the revenue by category?") includes cancelled
  orders without a knowledge file and correctly excludes them with one, purely
  from the injected instruction.
- **Cross-platform contextual memory** (`memory.js`, ported from
  `../core/memory.py`): after each answered question, a second LLM call
  produces a redacted summary (never raw SQL/rows, and — per a code review
  finding — never the raw question either, since it can contain literal
  identifiers) and writes it to a shared store. Other `DBAGENT_ID` instances
  pointed at the same store surface it as "Suggested from other agents" in
  the sidebar. Set `DBAGENT_ID` per instance (`run_local.sh` supports
  `DBAGENT_ID=oltp-sqlserver ./run_local.sh`, same as the Python app).
  Two backends, selected via `MEMORY_BACKEND`:
  - `local` (default) — JSONL + cosine similarity, no cloud setup.
  - `s3vectors` — `@aws-sdk/client-s3vectors`, **verified end-to-end against
    real AWS** (a provisioned vector bucket + index, write from one agent,
    retrieve from another, correct self-exclusion and TTL filtering all
    confirmed working). Requires `MEMORY_S3_BUCKET` + `MEMORY_ORG_ID` (used
    as the vector index name) and a pre-provisioned bucket/index — dimension
    must match `EMBEDDING_MODEL`'s output, distance metric `cosine`:
    ```bash
    aws s3vectors create-vector-bucket --vector-bucket-name your-bucket
    aws s3vectors create-index --vector-bucket-name your-bucket \
      --index-name demo-org --data-type float32 --dimension 768 \
      --distance-metric cosine
    ```
    (768 matches `nomic-embed-text`; use your embedding model's actual
    output dimension.) AWS credentials resolve via the standard SDK chain
    (env vars, shared config/profile, instance role, etc.).

  **Chat and embeddings are independent endpoints** (`EMBEDDING_BASE_URL`/
  `EMBEDDING_API_KEY`, default to `LLM_BASE_URL`/`LLM_API_KEY` if unset).
  This matters specifically for cross-platform memory: every agent sharing
  a vector store must use the *same embedding model* — not just the same
  dimension, cosine similarity across two different models' vector spaces
  is meaningless — but each agent's own chat/SQL-generation model can be
  anything. E.g. a local agent can run chat entirely on Ollama while
  routing only its embedding calls to Databricks AI Gateway, to share
  memory with a Databricks-deployed agent, verified end-to-end:
  ```bash
  EMBEDDING_BASE_URL=https://your-workspace.cloud.databricks.com/ai-gateway/mlflow/v1 \
    EMBEDDING_API_KEY=$DATABRICKS_TOKEN EMBEDDING_MODEL=system.ai.qwen3-embedding-0-6b \
    MEMORY_BACKEND=s3vectors MEMORY_S3_BUCKET=... MEMORY_ORG_ID=... \
    ./run_local.sh
  ```
  (One caveat found while testing: the OpenAI SDK defaults to
  `encoding_format: "base64"` for embeddings, which at least the Databricks
  AI Gateway route mishandled — silently returning a truncated vector with
  no error. `memory.js` forces `encoding_format: "float"` to avoid it.)
- **Benchmarks** (`benchmarks.js`, `benchmark.js`, `benchmarks.json`): a
  question paired with hand-verified ground-truth SQL, scored by result set
  (not SQL text) against the live pipeline — `npm run benchmark`. Three
  sources of cases, in the "Benchmarks" panel in the UI or via
  `GET/POST/DELETE /api/benchmarks`:
  - **seed** — `benchmarks.json`, repo-tracked, hand-verified. Failures are
    real regressions: reported, never auto-deleted.
  - **user** — added through the UI or the API.
  - **feedback** — auto-promoted from thumbs-up `/api/feedback` entries
    before each run (`IMPORT_FEEDBACK=false` to disable).

  Passing cases double as few-shot examples for the prompt (merged with
  `knowledge.json`'s own `examples`, same relevance-ranked selection — see
  `selectRelevantKnowledge` in `knowledge.js`) — a confirmed answer to
  "which SKU is best performing?" teaches the model your business's
  definition of "best" for similar future questions. A case only counts as
  "confirmed" once it has an actual passing run recorded; a never-run case
  is not used as an example, since that would let a bad self-submitted case
  validate itself the moment someone asks the same question again.

  user/feedback cases that **fail** a benchmark run are automatically
  removed from the ground-truth set *and* purged from shared memory's
  suggested follow-ups (`invalidateFollowup` in `memory.js`) — the same
  purge also fires immediately on a thumbs-down in `/api/feedback`, rather
  than waiting for the next benchmark run. This is what makes the
  ground-truth set self-healing instead of monotonically accumulating stale
  entries as the schema/data drifts.

  CI runs the suite on every change to `app/` via
  `.github/workflows/app-benchmark.yml`, gated on the
  `LLM_BASE_URL`/`LLM_API_KEY` repo secrets being configured (skipped, not
  failed, otherwise). Only a **seed** case failing fails the workflow.
- No streaming, no auth — this is a UI comparison prototype, not a
  production alternative to the Streamlit app.

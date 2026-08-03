# DB Agent (Node)

A Node.js/Express prototype of the same text-to-SQL agent as the root
Streamlit app — built to compare how the UI feels on a real frontend stack
(React + Tailwind + shadcn/ui) versus Streamlit's rerun-on-every-interaction
model and widget styling. See the root `README.md` for background on the
project.

Scope is intentionally narrower than the Python app in one respect: a
single LLM (no model failover chain). It does carry over the SQL
repair-on-failure loop and the cross-platform contextual memory feature.
The SQL layer itself is pluggable (`sqlEngines/`, same registry pattern as
the memory backends): `sqlite` (default, a local file), `minio-duckdb`
(Parquet objects in MinIO/any S3-compatible store, via DuckDB), or
`postgres` (any standard Postgres database — covers Databricks Lakebase
directly) — see Notes below.

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

`app.yaml` is the deploy manifest: `command`, `resources` (Databricks
secrets bound to the app object), and `env` (`value` for plain config,
`valueFrom` for anything resolved from a `resources` entry). A typical
deployment against Lakebase wires:

- `SQL_ENGINE=postgres` + `DB_URL` — Lakebase as the queried database (see
  "Notes" below for the role setup)
- `LLM_BASE_URL`/`LLM_MODEL`/`LLM_API_KEY` — the Databricks AI Gateway
  (Mosaic AI Model Serving), OpenAI-compatible
- `EMBEDDING_MODEL`/`EMBEDDING_API_KEY` — **a separate token from
  `LLM_API_KEY`.** Chat completions and embeddings are distinct AI Gateway
  routes with distinct tokens; reusing the chat token for embeddings fails
  auth. `EMBEDDING_API_KEY` falls back to `LLM_API_KEY` if unset, which
  works for some deployments but not others — set it explicitly.
- `MEMORY_BACKEND=pgvector` — optional, points cross-platform memory at
  Lakebase too (see the pgvector section below)

**A resource declared in `app.yaml` isn't automatically usable.**
`resources:` only states intent — each entry also has to be bound to the
app object itself via a separate API call:

```bash
databricks apps update <app-name> --json '{
  "resources": [
    {"name": "llm-api-key", "secret": {"scope": "db-agent", "key": "ai-gateway-token", "permission": "READ"}},
    {"name": "embedding-api-key", "secret": {"scope": "db-agent", "key": "embedding-token", "permission": "READ"}},
    {"name": "lakebase-db-url", "secret": {"scope": "db-agent", "key": "lakebase-db-url", "permission": "READ"}}
  ]
}'
```

Skipping this deploys fine but crashes the app at startup with `error
resolving resource <name>: resource not found`, since `valueFrom` has
nothing to resolve against yet.

**Deploying via GitHub Actions**: `.github/workflows/app-deploy-databricks.yml`
(manual `workflow_dispatch`) automates the whole flow — refreshes Databricks
secrets from GitHub repo secrets, runs the resource-binding step above,
syncs `app/` to the workspace, and deploys. Required repo secrets:
`DATABRICKS_TOKEN` (CLI auth — prefer a service-principal token, not a
personal one), `LLM_API_KEY`, `EMBEDDING_LLM_KEY`; required repo variable:
`DATABRICKS_HOST`. See the workflow file's header comment for the full list.
Re-running it after rotating a token is the whole "fix" for a stale-token
401 — no manual `databricks secrets put-secret` needed.

**If a token comes back invalid after setting it via the CLI or a shell
pipe**, check for a trailing newline — `echo "$TOKEN" | databricks secrets
put-secret ...` bakes one in, which then fails as `Bearer <token>\n is not
a legal HTTP header value`. Use `printf %s "$TOKEN" | ...` instead (what
the GitHub Actions workflow does). `server.js` also defensively `.trim()`s
`LLM_API_KEY`/`EMBEDDING_API_KEY` regardless of how they were set.

## Notes

- Uses Node's built-in `node:sqlite` module (stable in Node ≥ 22.5) — no
  native build step, unlike `better-sqlite3`.
- Mirrors `../core/sql_safety.py`'s safety rules and `../core/pipeline.py`'s
  SQL repair-on-failure loop (failed execution → error fed back to the LLM →
  re-validated before retrying) — same behavior, ported by hand since this is
  a separate runtime, not a shared library. `sqlSafety.js`'s validator runs
  identically regardless of which SQL engine is active (see below) — it
  gates the SQL string itself, before any engine ever sees it.
- **Pluggable SQL engines** (`sqlEngines/`): the same registry pattern as
  the memory backends below — `getSchema()`/`runQuery()` behind one
  interface, selected via `SQL_ENGINE`, adding a new one means one new file
  plus one registry entry, nothing in `server.js` changes.
  - `sqlite` (default) — Node's built-in `node:sqlite` module (stable in
    Node ≥ 22.5) against `DB_PATH` (a local file, `./data/demo.db` by
    default) — no native build step, unlike `better-sqlite3`.
  - `minio-duckdb` — Parquet objects in MinIO (or any S3-compatible object
    store), queried through [DuckDB](https://duckdb.org)'s `httpfs`
    extension. MinIO holds no live database here, just Parquet files under
    a bucket/prefix; DuckDB is the query engine. **Verified end-to-end
    against a real local MinIO instance** (Docker, not mocked): schema
    introspection, a multi-table join, and the repair loop's error-catching
    path all confirmed working.

    Convention: every `<bucket>/<prefix>/<table>.parquet` object becomes one
    logical table named `<table>`, exposed as a DuckDB view over
    `read_parquet()` — the LLM's generated SQL never needs to know an S3
    path or Parquet is involved, it just sees table names like any other
    engine. **Partitioned or multi-file-per-table datasets aren't supported
    in this first pass** — each table must be exactly one Parquet object.
    Iceberg table support (DuckDB has an `iceberg` extension, and MinIO's
    AIStor product supports Iceberg-backed tables natively) is a natural
    next step but isn't wired up yet.

    Requires `MINIO_ENDPOINT` + `MINIO_BUCKET` (see `.env.example`); tables
    are discovered once at startup via `glob()`, so adding/removing a
    Parquet object under the prefix needs a server restart to pick up —
    not re-scanned per request. `s3_url_style` is forced to `path`, which
    MinIO (and most self-hosted S3-compatible stores) require — AWS S3
    itself defaults to virtual-hosted style, which is why this isn't
    DuckDB's own default.

    **Caveat found while testing**: DuckDB's `BIGINT` columns (which is what
    `COUNT(*)`/integer aggregates come back as) are returned as JSON
    *strings*, not native JSON numbers, in query results — a raw JS
    `bigint` isn't valid input to `JSON.stringify` (which `res.json()` uses
    under the hood), so the DuckDB Node API stringifies rather than crash
    the response. `DOUBLE` columns (e.g. `SUM(price)`) come back as normal
    numbers. Something to know if you're formatting result values on the
    frontend.

    **Quick local demo** (for a live walkthrough, not just a smoke test):
    ```bash
    cd app
    docker compose -f scripts/minio-demo-compose.yml up -d   # real MinIO, localhost:9000/9001
    node scripts/seed-minio-demo.js                            # exports data/demo.db -> Parquet -> uploads to MinIO
    SQL_ENGINE=minio-duckdb MINIO_ENDPOINT=localhost:9000 MINIO_BUCKET=demo-bucket \
      MINIO_PREFIX=db-agent-demo MINIO_ACCESS_KEY=minioadmin MINIO_SECRET_KEY=minioadmin \
      MINIO_USE_SSL=false ./run_local.sh
    ```
    Seeds the same customers/products/orders demo domain as the SQLite
    default (exported via DuckDB's `sqlite` extension, so no separate
    dataset to maintain) — ask it the same questions you'd ask the SQLite
    demo and compare. MinIO console at `http://localhost:9001`
    (`minioadmin`/`minioadmin`) if you want to browse the uploaded Parquet
    objects visually mid-demo.
  - `postgres` — any standard Postgres database, via [`pg`](https://node-postgres.com)
    (node-postgres). Covers **Databricks Lakebase directly** — Lakebase
    speaks the standard Postgres wire protocol, so this engine has no
    Lakebase-specific code, just connection details pointed at it. **Verified
    end-to-end against a real Lakebase instance** (a Kaggle Olist e-commerce
    dataset, 12 tables) — schema introspection and a live query both
    confirmed working, local Ollama generating the SQL.

    Either a full connection string (`DB_URL`) or individual
    `PG_HOST`/`PG_PORT`/`PG_DATABASE`/`PG_USER`/`PG_PASSWORD` fields (see
    `.env.example`). Lakebase's own connection-details panel gives you a
    `postgresql+psycopg://...` string (a Python-driver convention) — that
    works as-is for `DB_URL`, node-postgres's connection-string parser
    ignores the `+psycopg` suffix. `PG_SSL` defaults to TLS with relaxed
    certificate validation (works against most managed-Postgres CA chains
    out of the box); set `PG_SSL=strict` for full verification or
    `PG_SSL=false` to disable TLS (local Postgres only, never for Lakebase).

    No PII-aware sample-value mining in this first pass (same scope decision
    as `minio-duckdb`) — every column is exposed as name+type only. **Prefer
    a dedicated, long-lived Postgres role over a short-lived Databricks
    OAuth token as the password** — this is Databricks' own guidance for
    long-running workloads, and avoids the recurring 401s a ~1hr-expiring
    token causes on every deployment. Create one with plain `CREATE ROLE ...
    WITH LOGIN PASSWORD` + `GRANT CONNECT/USAGE/SELECT`, scoped to
    `SELECT`-only for this engine (a separate, write-capable role is used
    for `MEMORY_BACKEND=pgvector` below — never the same role for both). If
    you do use an OAuth token anyway, an expired one surfaces as a normal
    Postgres auth error in the `/api/ask` response, not a crash.
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
  Pluggable backends (`memoryBackends/`, same registry pattern as the SQL
  engines above), selected via `MEMORY_BACKEND`:
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
  - `milvus` — self-hosted or Zilliz Cloud, via `@zilliz/milvus2-sdk-node`.
    Auto-creates its collection/index on first use.
  - `pgvector` — any Postgres with the `pgvector` extension, via `pg` (the
    same driver `SQL_ENGINE=postgres` uses). Covers **Databricks Lakebase
    directly** — **verified end-to-end against a real Lakebase instance**
    (`pgvector` 0.8, HNSW index, confirmed present before writing this):
    `put`/`query` with correct self-exclusion and TTL filtering, and
    `invalidateFollowup` as an exact match over a real array column rather
    than the best-effort semantic lookup the other two vector backends need
    (see `memoryBackends/pgvector.js`'s header comment for why Postgres
    doesn't need that workaround — it can do similarity ranking, TTL
    filtering, and self-exclusion in one indexed query). Auto-creates the
    extension/table/index on first use; falls back to the same connection
    as `SQL_ENGINE=postgres` (`DB_URL`/`PG_*`) if `MEMORY_PG_*` is unset.

    The connecting role needs `INSERT`/`UPDATE`/`SELECT` on its own
    `db_agent_memory_*` table (and `CREATE` on the schema, the first time,
    to make that table) — **do not reuse a read-only role** scoped for
    `SQL_ENGINE=postgres`, it can't write:
    ```sql
    CREATE EXTENSION IF NOT EXISTS vector;
    CREATE ROLE db_agent_memory_rw WITH LOGIN PASSWORD '...';
    GRANT CONNECT ON DATABASE your_db TO db_agent_memory_rw;
    GRANT USAGE, CREATE ON SCHEMA public TO db_agent_memory_rw;
    ```

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
- **Timestamped request logging** (`logger.js`): every server log line is
  prefixed with an ISO timestamp, and `/api/ask` logs a line at each stage
  of the pipeline — request start (with which SQL engine/location is
  serving it), SQL generated, each repair attempt, and done (with row count
  and repair-attempt count). No duration/timing math is done by the app
  itself on purpose — diff the timestamps yourself to see where time is
  actually going (LLM call vs. query execution vs. repairs), since that's
  more trustworthy than a single self-reported number would be.
- No streaming, no auth — this is a UI comparison prototype, not a
  production alternative to the Streamlit app.

# DB Agent · Databricks App

A natural-language SQL agent that runs natively inside your Databricks workspace.
Ask questions in plain English — it generates safe, explainable SQL against your
Delta tables.

This is the **"AI agent meets real production"** example: the same agentic
pipeline you see in [`../modules/`](../modules/) (schema → LLM → validate →
execute), deployed to a real workspace with service-principal auth, Unity
Catalog, and Secret Scopes.

---

## What's different from the generic version

| | Generic (`streamlit_app/`) | Databricks App (`databricks_app/`) |
|---|---|---|
| Auth | Manual `DB_URL` + PAT | OAuth service principal (auto-injected) |
| SQL target | SQLite / Postgres | Unity Catalog Delta tables |
| Schema source | SQLAlchemy `inspect()` | `INFORMATION_SCHEMA.COLUMNS` |
| Secrets | `.env` file | Databricks Secret Scopes |
| LLM | OpenAI / Ollama | Databricks Model Serving *or* any OpenAI-compatible endpoint |
| Deploy | Local / Docker | `databricks apps deploy` |

---

## Architecture

```
app.py              Streamlit UI — sidebar, schema browser, result panels
  │
  ├── pipeline.py   Orchestrates the end-to-end flow
  │     ├── prompts.py      Builds schema-aware system + user prompts
  │     ├── llm.py          Calls the LLM via any OpenAI-compatible endpoint
  │     ├── sql_safety.py   Whitelists SELECT-only SQL before it ever runs
  │     └── connector.py    Databricks SQL driver — auth, schema, query
  │
  ├── config.py     Env-var config, Databricks-aware defaults, secret fetch
  └── models.py     Pydantic contracts (LLMConfig, SQLResponse, PipelineOutput)
```

The pipeline never raises — errors are captured into `PipelineOutput.error` so
the UI can display a friendly message instead of a stack trace.

---

## Local dev

```bash
cd databricks_app

python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
# Edit .env — set DATABRICKS_HOST, DATABRICKS_TOKEN, DATABRICKS_CATALOG, DATABRICKS_SCHEMA

streamlit run app.py
```

Locally the app uses `DATABRICKS_TOKEN` (a personal access token) to talk to
the SQL Warehouse. In production you'll use OAuth — see below.

---

## Deploy to Databricks Apps

### Prerequisites

- Databricks CLI (`brew install databricks` or `pip install databricks-cli`)
- Authenticated: `databricks auth login`
- One SQL Warehouse in the workspace (any size — Serverless Starter works)
- A Unity Catalog schema you want to query

### Step 1 — Create the app

```bash
databricks apps create db-agent --description "Natural-language SQL agent"
```

This provisions a **service principal** dedicated to this app. From now on,
"the app" and "its service principal" are the same identity for permission
purposes.

### Step 2 — Upload the code

`databricks apps deploy` reads from a **workspace path**, not a local path —
so first upload the code.

```bash
databricks sync ./databricks_app /Workspace/Users/<YOU>@example.com/db-agent-app/
```

> `databricks sync` does **not** respect `.gitignore`. Don't ship secrets:
> verify `.env` isn't in the source folder before syncing.

### Step 3 — Configure `app.yaml`

Edit [`app.yaml`](./app.yaml) with your workspace values:

```yaml
command: ["streamlit", "run", "app.py"]

env:
  - name: "DATABRICKS_CATALOG"
    value: "samples"                            # your Unity Catalog catalog
  - name: "DATABRICKS_SCHEMA"
    value: "accuweather"                        # your schema
  - name: "DATABRICKS_HTTP_PATH"
    value: "/sql/1.0/warehouses/<warehouse-id>" # pin the warehouse
```

> **Don't override Streamlit server flags** (`--server.port`, `--server.headless`,
> `--server.enableCORS`) in `command`. Databricks Apps injects its own Streamlit
> config via the reverse proxy. Overriding them breaks the proxy handshake —
> the app starts, logs say "healthy", but the browser shows "app not available."

### Step 4 — Deploy

Point `deploy` at the **subfolder** containing `app.yaml`, not the repo root:

```bash
databricks apps deploy db-agent \
  --source-code-path /Workspace/Users/<YOU>@example.com/db-agent-app
```

Check the app URL:

```bash
databricks apps get db-agent   # look for the url field
```

### Step 5 — Grant the app's service principal access

The app's SP is authenticated but has no permissions by default. Grant:

| Resource | Permission | Why |
|---|---|---|
| Your SQL Warehouse | `CAN_USE` | Execute queries |
| Unity Catalog catalog | `USE CATALOG` | See the catalog |
| Schema | `USE SCHEMA` | See tables in the schema |
| Tables (or schema) | `SELECT` | Read the data |

You can grant via the Catalog Explorer UI or SQL:

```sql
GRANT USE CATALOG ON CATALOG samples TO `<app-sp-application-id>`;
GRANT USE SCHEMA  ON SCHEMA samples.accuweather TO `<app-sp-application-id>`;
GRANT SELECT      ON SCHEMA samples.accuweather TO `<app-sp-application-id>`;
```

Find the SP application ID in **Compute → Apps → db-agent → Authorization**.

### Step 6 — Restart and test

```bash
databricks apps start db-agent    # if not auto-started
```

The sidebar should show a green **SQL Warehouse connected** banner.

---

## Using an external LLM (GitHub Models / OpenAI / Azure OpenAI)

By default the app uses **Databricks Model Serving** — no external key needed.
To plug in GitHub Models (Grok, GPT-4o, Llama) or OpenAI directly:

### Store the API key as a secret

```bash
databricks secrets create-scope db-agent
databricks secrets put-secret db-agent github-token --string-value "ghp_xxx"
```

Grant the app's SP read access to the scope:

```bash
databricks secrets put-acl db-agent <app-sp-application-id> READ
```

### Tell the app to use it

In `app.yaml`:

```yaml
env:
  - name: "LLM_BASE_URL"
    value: "https://models.github.ai/inference"
  - name: "LLM_MODEL"
    value: "openai/gpt-4o"          # or xai/grok-3 (avoid -mini, 4k ctx is too small)
  - name: "DATABRICKS_SECRET_SCOPE"
    value: "db-agent"
  - name: "DATABRICKS_SECRET_KEY"
    value: "github-token"
```

`config.py` reads the secret directly via the Databricks SDK at startup and
injects it as `LLM_API_KEY`. We avoid the `valueFrom` + `resources` indirection
because approval flow can be finicky — reading the secret in code is simpler
and works whenever the SP has the ACL.

### LLM endpoint reference

| Provider | `LLM_BASE_URL` | Example model |
|---|---|---|
| Databricks Model Serving (default) | `https://{workspace}/serving-endpoints` | `databricks-meta-llama-3-3-70b-instruct` |
| GitHub Models | `https://models.github.ai/inference` | `openai/gpt-4o`, `xai/grok-3` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| Azure OpenAI | `https://{resource}.openai.azure.com/openai/deployments/{deployment}` | `gpt-4o` |

---

## Auth explained

```
Local dev
  .env sets DATABRICKS_TOKEN (PAT)
  WorkspaceClient()                   → PAT auth
  databricks_sql.connect(access_token=token)

Databricks App (deployed)
  Runtime injects DATABRICKS_CLIENT_ID + DATABRICKS_CLIENT_SECRET
  WorkspaceClient()                   → M2M OAuth
  databricks_sql.connect(credentials_provider=...)
```

`config.py` pops `DATABRICKS_TOKEN` when it detects OAuth credentials — without
this, the SDK raises `more than one authorization method configured` because
leftover PAT from `.env` (if it got uploaded) collides with the injected
OAuth env vars.

---

## SQL safety

Every generated query is validated before execution:

- Must be a single `SELECT` (or `WITH … SELECT`)
- No `DROP`, `DELETE`, `UPDATE`, `INSERT`, `ALTER`, `TRUNCATE`, `MERGE`
- No Databricks-specific write ops: `OPTIMIZE`, `VACUUM`, `ZORDER`, `COPY INTO`
- Result set capped at 100 rows in `connector.run_query()`

See [`sql_safety.py`](./sql_safety.py).

---

## Troubleshooting

### "App not available" in the browser, but logs say "Deployment successful"

Almost always one of:

1. **You overrode `--server.port` / `--server.headless` / `--server.enableCORS`
   in `command`.** Remove them — Databricks injects these. Keep `command`
   minimal: `["streamlit", "run", "app.py"]`.
2. **You deployed from the wrong path.** `--source-code-path` must point at the
   directory that contains `app.yaml`, not the repo root. If the repo has
   multiple app folders (`streamlit_app/`, `databricks_app/`, `fullstack_app/`),
   Databricks cannot guess which one.

### "Cannot reach SQL Warehouse"

Surface the real error by replacing `check_connection()`'s `except Exception:
return False` with `st.code(f"{type(exc).__name__}: {exc}")` — it's almost
always one of:

- **`validate: more than one authorization method configured: oauth and pat`**
  → `DATABRICKS_TOKEN` got set (probably from a synced `.env`). `config.py`
  now clears it when OAuth creds are present. Rebuild and redeploy.
- **`PERMISSION_DENIED` / `403`** → the app's SP lacks `CAN_USE` on the
  warehouse, or `USE CATALOG` / `USE SCHEMA` / `SELECT` on the data.
- **`NO_WAREHOUSES_FOUND`** → pin the warehouse via `DATABRICKS_HTTP_PATH`
  in `app.yaml` so auto-discovery isn't required.

### LLM call returns `401 Unauthorized`

Either the env var isn't populated, or the token is wrong.

Add a debug expander in the sidebar to confirm (see `app.py`):

```python
st.write({
    "LLM_API_KEY_len":  len(os.environ.get("LLM_API_KEY", "")),
    "LLM_BASE_URL":     os.environ.get("LLM_BASE_URL"),
    "LLM_MODEL":        os.environ.get("LLM_MODEL"),
})
```

- `len == 0` → secret isn't reaching the container. Either the SP lacks READ
  ACL on the scope, or your `valueFrom` reference didn't resolve. The
  **most reliable fix** is to drop `valueFrom` entirely and read the secret
  in `config.py` using `WorkspaceClient().secrets.get_secret(...)` — this is
  what `config.py` does by default now.
- Length looks right but still 401 → verify the raw token with curl:

  ```bash
  curl -sS https://models.github.ai/inference/chat/completions \
    -H "Authorization: Bearer <token>" \
    -H "Content-Type: application/json" \
    -d '{"model":"openai/gpt-4o","messages":[{"role":"user","content":"hi"}]}'
  ```

### `413 tokens_limit_reached`

The schema plus prompt exceeds the model's context window. `grok-3-mini` on
GitHub Models caps at 4000 tokens — much too small for most Databricks
catalogs. Switch to a larger-context model (`openai/gpt-4o`, `xai/grok-3`,
or any Databricks Model Serving endpoint).

### "Cannot read secret" when reading via SDK

Confirm the ACL:

```bash
databricks secrets list-acls db-agent
# Should include the app's SP with READ

databricks secrets put-acl db-agent <app-sp-application-id> READ
```

---

## How this maps to the AI Agent concepts in [`../modules/`](../modules/)

| Concept | Module | Where it lives here |
|---|---|---|
| LLM call with structured output | 02 | [`llm.py:call_llm`](./llm.py), [`models.py:SQLResponse`](./models.py) |
| Prompt assembly with schema context | 02 | [`prompts.py`](./prompts.py) |
| Tool / function around real data | 03 | [`connector.py:get_schema`](./connector.py), [`connector.py:run_query`](./connector.py) |
| Orchestration loop | 04 | [`pipeline.py:run_pipeline`](./pipeline.py) |
| Serving over a protocol for other agents | 05 | Not here — see [`../modules/05_mcp_server/`](../modules/05_mcp_server/) |

This app is the "pipeline" shape (developer decides the order of steps). The
[module 03](../modules/03_tool_use/) and [module 04](../modules/04_agentic_loop/)
agents flip that: the LLM decides which tool to call next. Both shapes have
their place — pipelines are deterministic and auditable, agents are flexible
and exploratory.

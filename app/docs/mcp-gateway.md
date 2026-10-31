# MCP gateway

Run db-agent as an MCP server so Claude Desktop, GitHub Copilot in VS Code and any other MCP client can query
your database through one set of rules, with every call in one log. Each client holds its own API key, so you can
see who asked what, and expensive queries wait for a human to approve them.

## Tools

| Tool | What it does |
|---|---|
| `list_tables` | Tables this caller may see (after the table policy). |
| `describe_table` | Columns and types, plus descriptions from `knowledge.json`. |
| `ask` | Plain-language question. db-agent writes a read-only query, checks cost, runs it. Returns SQL, rows, cost estimate. |
| `run_sql` | A SELECT the caller wrote. Same safety check, table policy and cost guard. |
| `explain_cost` | Estimate only, nothing runs. Says whether the query would need approval. Needs an engine that can estimate (Postgres, Databricks); SQLite and DuckDB report that no estimate is available. |

Both `ask` and `run_sql` use the same pipeline as the web UI: SELECT-only validator, cost guard
(`APPROVAL_MAX_BYTES`, `APPROVAL_MAX_ROWS`, `APPROVAL_MAX_COST_USD`), then execution. MCP calls do not write to the memory store.

## Quick setup

```bash
db-agent mcp setup                       # Claude Desktop, VS Code and Claude Code, whichever are installed
db-agent mcp setup --client vscode       # just one
db-agent mcp setup --dry-run             # show what would change
```

For each tool it makes a key, adds the key's hash to `gateway.json`, writes the tool's MCP config (merged into any
existing file, with a `.bak-<time>` copy first), and connects once as that tool to check it works. Then restart
Claude Desktop or reload VS Code. VS Code gets the user-level `mcp.json`; use `--workspace` to write `.vscode/mcp.json`
in the current folder instead. Re-running makes new keys for the tools you name. A config file with comments is left
alone and reported. The key sits in plain text in each tool's own config file, because those tools have nowhere else to keep it.
The manual steps below do the same thing by hand.

## Set up

1. Copy `gateway.example.json` to `gateway.json` (ignored by git) and list your callers. One key per AI tool:

```json
{
  "callers": [
    { "key": "env:DB_AGENT_KEY_CLAUDE",  "user": "alice", "team": "analytics", "tool": "claude-desktop" },
    { "key": "env:DB_AGENT_KEY_COPILOT", "user": "alice", "team": "analytics", "tool": "vscode-copilot" },
    { "keySha256": "<64 hex chars>", "user": "bob", "team": "finance", "tool": "ci-bot", "allowTables": ["orders"] }
  ],
  "tables": { "deny": ["customers"] },
  "limits": { "maxRows": 200 }
}
```

- `key`: at least 16 characters, or `env:NAME` to read it from the environment. A caller whose variable is not set is skipped with a warning. Use `keySha256` for stdio clients: an AI tool only passes the server the `env` block in its own config, so `env:` keys are not visible there. `keySha256` stores only the hash
  (`printf '%s' "$KEY" | shasum -a 256`). Keys are compared by hash and are never logged.
- `tables.deny` / `tables.allow`: global table policy. A caller's `allowTables` narrows it further. SQL that mentions a
  hidden table anywhere is blocked, and hidden tables are left out of the prompt and out of `list_tables`.
  This is a text check (fail closed), not a boundary. **Use a read-only database role as the real boundary.**
- `limits.maxRows`: rows returned to the AI tool per call (default 200). Engines also cap rows themselves (`PG_MAX_ROWS`).
- The config is JSON, not YAML, so there is no extra dependency.

2. Point db-agent at your database as usual (`SQL_ENGINE`, `DB_URL`, ... in `app/.env`) and, for `ask`, an LLM.

3. Start it. From `app/`:

```bash
node bin/db-agent.js mcp serve --stdio    # an AI tool launches this; key in DB_AGENT_API_KEY
node bin/db-agent.js mcp serve --http --port 3002   # http://127.0.0.1:3002/mcp, key as a Bearer token
```

After `npm link` (or a global install) the command is just `db-agent`. HTTP binds to 127.0.0.1 by default and speaks
plain HTTP: put TLS in front of anything that is not local.

Other settings: `GATEWAY_CONFIG` (path to the config), `GATEWAY_DB` (default `data/gateway.db`), `APPROVAL_TTL_MINUTES` (default 60), `MCP_PORT`, `MCP_HOST`.

## Client configs

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "db-agent": {
      "command": "node",
      "args": ["/absolute/path/to/db-agent/app/bin/db-agent.js", "mcp", "serve", "--stdio"],
      "env": { "DB_AGENT_API_KEY": "<the key for claude-desktop>" }
    }
  }
}
```

**VS Code, GitHub Copilot** (`.vscode/mcp.json`), over HTTP:

```json
{
  "inputs": [
    { "type": "promptString", "id": "db-agent-key", "description": "db-agent API key", "password": true }
  ],
  "servers": {
    "db-agent": {
      "type": "http",
      "url": "http://127.0.0.1:3002/mcp",
      "headers": { "Authorization": "Bearer ${input:db-agent-key}" }
    }
  }
}
```

or over stdio (`"type": "stdio"`, `"command": "node"`, `"args": [".../bin/db-agent.js", "mcp", "serve", "--stdio"]`,
`"env": { "DB_AGENT_API_KEY": "${input:db-agent-key}" }`).

**Any HTTP client** (`x-api-key: <key>` also works):

```bash
curl -s http://127.0.0.1:3002/mcp \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"run_sql","arguments":{"sql":"SELECT 1"}}}'
```

## What the AI tool sees

- Blocked: `Blocked: Forbidden keyword detected: DELETE.`, `Blocked: Multiple SQL statements detected...`,
  `Blocked: table "customers" is not available to this caller.`
- Held: `Needs approval: Estimated 300,000 rows exceeds the 1,000 row limit. Approval id: apr_cd20d44ec6. ...`
- A bad key: stdio refuses to start; HTTP answers 401. Both are logged as `rejected_auth`.

## Approvals

A held query is stored with an approval id. An approver, on a machine that can read the same `gateway.db`:

```bash
db-agent approvals            # pending
db-agent approve apr_cd20d44ec6   # prints caller, reason and SQL, then approves
db-agent deny apr_cd20d44ec6
```

The AI tool then calls the same tool again with `approval_id`. The approval:

- is bound to the caller (user and tool) and to the tool that was held, and expires after `APPROVAL_TTL_MINUTES`;
- runs exactly the SQL that was held (an `ask` is not sent back through the LLM), after the safety check and table policy run again;
- works once.

There is no approval screen in the web UI yet. Anyone who can run the CLI against the shared store can approve.

## The log

`db-agent log` shows recent calls. The table is `requests` in `gateway.db`: time, user, team, tool, MCP tool,
question, SQL, status (`ok`, `blocked`, `needs_approval`, `error`, `rejected_auth`), reason, approval id, estimated
bytes and rows, rows returned, duration. SQL and questions are stored as typed, so they can contain literal values;
API keys are never stored.

## Audit trail export

Compliance can see who asked what, which tables the SQL touched, the decision, and who approved it. The export
joins the request log to the approvals, so a held query that was later approved shows the approver and the time.

Try it in 5 minutes (after a few calls, or on the demo data from the section at the end):

```bash
db-agent audit export --from 2025-01-01 --to 2025-01-31 --format csv --out january.csv
db-agent audit export --team finance --decision blocked --format jsonl
db-agent audit export --table customers --user alice
db-agent audit export --redact          # no questions, and SQL values replaced by ?
```

Filters: `--from`, `--to` (a date like `2025-01-31`, which includes that whole day for `--to`, or a full ISO time,
both in UTC), `--user`, `--team`, `--tool`, `--decision` (`ok`, `blocked`, `needs_approval`, `error`,
`rejected_auth`) and `--table`. Without `--out` the records go to the terminal and the count to stderr.

Columns: id, ts, channel, user, team, tool, mcp_tool, decision, reason, question, sql, tables, rows_returned,
duration_ms, model, token counts, llm_usd, warehouse_usd, approval_id, approval_status, approved_by, approved_at.
CSV cells that start with `=`, `+`, `-` or `@` get a leading quote so a spreadsheet does not run them.

`tables` is read from the SQL text (names after FROM, JOIN, UPDATE, INTO and TABLE). It is a good guide, not a
parser: a CTE name can appear as a table. `approved_by` is the operating system user who ran `db-agent approve`.

### Retention

Off by default (everything is kept). To keep 90 days, set `AUDIT_RETENTION_DAYS=90` or add this to `gateway.json`
(the environment variable wins):

```json
{ "retention": { "days": 90 } }
```

`db-agent mcp serve` and the web server then purge at start and every 6 hours. Purge by hand with
`db-agent audit purge --days 90` (add `--dry-run` to count first). It removes requests and finished approvals
older than the limit and keeps approvals that are still waiting. If you run neither server, run the purge from cron.

## Limits

- The web UI's own Run/Approve buttons are separate and are not in this log yet.
- `explain_cost` takes SQL only, not a question.
- Row caps: the AI tool gets at most `limits.maxRows` rows, and the engine may cap earlier (Postgres `PG_MAX_ROWS`, default 1000), without saying so in the reply.

## Costs, budgets and the spend report

Every request is logged with its tokens and two cost estimates. **These are estimates, not bills.** LLM cost is
`tokens x your price`; warehouse cost is the optimizer's estimate (Databricks: the compute-cost estimate;
other engines: estimated bytes scanned x `perGbScanned`, which defaults to 0).

```json
"pricing": {
  "models":  { "gpt-4o-mini": { "inputPer1M": 0.15, "outputPer1M": 0.6 } },
  "engines": { "postgres": { "perGbScanned": 0.005 } }
},
"budgets": [
  { "scope": "team", "name": "analytics", "metric": "llm_usd",       "period": "month", "limit": 50, "action": "approval" },
  { "scope": "user", "name": "*",         "metric": "tokens",        "period": "day",   "limit": 500000, "action": "warn" },
  { "scope": "tool", "name": "ci-bot",    "metric": "warehouse_usd", "period": "day",   "limit": 5, "action": "block" }
]
```

- `scope`: `user`, `team` or `tool`. `name` is one value, or `*` to give each user, team or tool its own allowance.
- `metric`: `tokens`, `llm_usd` or `warehouse_usd` (tokens and `llm_usd` apply to `ask`; `warehouse_usd` to `ask` and `run_sql`).
- `period`: `day` or `month`, both UTC.
- `action`: `warn` (runs, with a warning), `approval` (held for `db-agent approve`, then runs once) or `block`.
- A budget is checked against what was already spent, so the request that crosses the limit completes and the next one gets the action.
- A model with no entry in `pricing.models` has no LLM cost in the totals, and the report says so. Local models: price them at 0.
- Each `ask` and `run_sql` answer includes a `usage` block: tokens, the two estimates, and what is left of each budget.
- Tokens count SQL generation and repair calls. Embedding calls (example selection) are not counted. If the model server does not report usage, tokens show as unreported rather than zero.

```bash
db-agent report --period week            # day | week | month (rolling), prints Markdown, writes .md and .csv to ./db-agent-reports
http://localhost:3001/api/report?format=html&period=week   # the same report as tables in a browser (web server)
```

The report covers spend by team, tool, user and model, the 10 most expensive questions, and blocked / held counts.
Web UI requests are logged too (tool `web-ui`, no user or team, so they appear under `(none)` by team). Budgets apply to MCP callers only,
because the web UI has no identity. The web page has no login; do not expose it beyond people who may see every question.
Cache savings show "not available" until the result cache (#73) exists.

### Demo data for the report

The prices in `gateway.example.json` for the local Qwen models are **illustrative** (a rough stand-in for what
hosting them would cost), not real bills. Replace them with your own.

`scripts/demo-traffic.js` fills a separate request log with real traffic: four MCP callers on different teams, tools and
models (0.5b, 1.5b, 7b) asking the Olist questions, web UI requests, blocked writes and bad keys. It never touches your real log:

```bash
SEED_DB_URL=postgresql://postgres:pw@localhost:5456/olist SEED_ORDER_ITEMS=500000 node scripts/seed-olist-postgres.js seed --yes
DB_URL=postgresql://postgres:pw@localhost:5456/olist PG_SSL=false node scripts/demo-traffic.js     # about 3 minutes
GATEWAY_DB=data/gateway-demo.db GATEWAY_CONFIG=data/gateway-demo.json node server.js              # then open /api/report?format=html
```

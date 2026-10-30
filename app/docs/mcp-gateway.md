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

## Limits

- The web UI's own Run/Approve buttons are separate and are not in this log yet.
- `explain_cost` takes SQL only, not a question.
- Row caps: the AI tool gets at most `limits.maxRows` rows, and the engine may cap earlier (Postgres `PG_MAX_ROWS`, default 1000), without saying so in the reply.

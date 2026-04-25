# Module 05 — MCP Server

**Concept:** Expose your database tools via the Model Context Protocol so *any* MCP-compatible client can use them — without writing agent code.

Open [`mcp_server.ipynb`](mcp_server.ipynb) in a Databricks workspace (the free tier is enough) and run the cells top-to-bottom.

## The big idea

In Modules 03 and 04 you wrote a custom agent: tool definitions, a tool executor, a message loop. That code is tightly coupled to the OpenAI SDK and only runs in your Python script.

**MCP (Model Context Protocol)** is a standard that separates tool implementation from tool consumption:

```
Without MCP:                        With MCP:
  your_agent.py                       Claude Desktop ─┐
  ├── tool definitions                Cursor IDE      ─┤─► mcp_server  ─► database
  ├── tool executor                   your_agent.py  ─┘
  └── message loop
```

Write the server once → use it from Claude Desktop, Cursor, Continue, your own agents — anything that speaks MCP.

## Setup

1. Import `mcp_server.ipynb` into Databricks.
2. Attach to any cluster or serverless compute.
3. Run the first cell — installs the `mcp` SDK and restarts Python.
4. Pick a `CATALOG` / `SCHEMA` widget value (defaults to `samples` / `bakehouse`).
5. Run the remaining cells. The notebook exercises the server through MCP's own `call_tool` entry point — no separate process needed.

## What the server exposes

| Tool | Description |
|------|-------------|
| `list_tables` | Get all table names in the current schema |
| `describe_table` | Get columns and types for a specific table |
| `run_query` | Execute a read-only SELECT query (safety-checked) |

## Deploying outside the notebook

The same server code can be deployed as:

- **Streamable HTTP** (recommended on Databricks): host it as a Databricks App and start with `mcp.run(transport="streamable-http", host="0.0.0.0", port=8000)`. Clients point at `https://<your-app>/mcp`.
- **stdio** (Claude Desktop on a laptop): save the tool definitions to a `server.py` and add an entry to `claude_desktop_config.json`.

## Key teaching moment

Your MCP server = the **tool** (stateless, reusable, protocol-compliant).
Claude Desktop / Cursor / your agent = the **orchestrator** (decides when and how to use the tool).

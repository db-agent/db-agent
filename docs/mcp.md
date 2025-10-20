# Model Context Protocol Server

This repository ships with a stdio-based [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that exposes the agent runtime tools. The server is implemented in `mcp_server/main.py` and can be used by MCP-compatible clients (such as the VS Code MCP extension) to access schema inspection, SQL execution, and result summarisation functionality.

## Running the server

```bash
python -m mcp_server.main
```

The server reads database and model configuration from environment variables using the existing runtime configuration service. You can export the variables before starting the server or load them via `.env` using `python-dotenv`.

Key variables include:

- `DB_DRIVER`, `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`
- `LLM_BACKEND`, `MODEL`, `LLM_ENDPOINT`, `LLM_API_KEY`

## Exposed tools

The MCP server surfaces three tools that mirror the built-in runtime capabilities:

| Tool | Description |
| ---- | ----------- |
| `schema_inspection` | Returns the database schema for the configured connector. |
| `run_sql` | Executes an arbitrary SQL statement and returns the rows/columns. |
| `summarize_results` | Provides a short natural language summary for a tabular result set. |

Each tool advertises JSON schemas for its arguments and results. See the integration tests in `tests/test_mcp_server.py` for end-to-end request/response examples.

## VS Code configuration example

The MCP VS Code extension looks for a `mcp.json` file. A ready-to-copy example lives at [`config/mcp.json`](../config/mcp.json) and defines a `db-agent` server entry that launches this project via `python -m mcp_server.main`.

To use it:

1. Copy `config/mcp.json` to your VS Code user settings directory (or merge it into an existing MCP configuration).
2. Adjust the `env` block to point to your database credentials and model provider keys.
3. Reload VS Code and connect to the `db-agent` server from the MCP extension UI.

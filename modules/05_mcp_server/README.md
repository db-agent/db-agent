# Module 05 — MCP Server

**Concept:** Expose your database tools via the Model Context Protocol so *any* MCP-compatible client can use them — without writing agent code.

## The big idea

In Modules 03 and 04 you wrote a custom agent: tool definitions, a tool executor, a message loop.
That code is tightly coupled to the OpenAI SDK and only works in your Python script.

**MCP (Model Context Protocol)** is a standard that separates tool implementation from tool consumption:

```
Without MCP:                        With MCP:
  your_agent.py                       Claude Desktop ─┐
  ├── tool definitions                Cursor IDE      ─┤─► mcp_server.py ─► database
  ├── tool executor                   your_agent.py  ─┘
  └── message loop
```

Write the server once → use it from Claude Desktop, Cursor, Continue, your own agents — anything that speaks MCP.

## Run the server

```bash
pip install "mcp[cli]"

# Test it with the MCP inspector (browser UI):
mcp dev modules/05_mcp_server/server.py

# Or run it directly (stdio transport):
python modules/05_mcp_server/server.py
```

## Connect to Claude Desktop

Add this to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on Mac):

```json
{
  "mcpServers": {
    "db-agent": {
      "command": "python",
      "args": ["/Users/chandan/workspace/db-agent/modules/05_mcp_server/server.py"],
      "env": {
        "LLM_API_KEY": "not-needed-for-mcp",
        "DB_URL": "sqlite:////Users/chandan/workspace/db-agent/data/demo.db"
      }
    }
  }
}
```

Then restart Claude Desktop. You'll see a hammer icon — click it to see the tools.
Now ask Claude: *"What tables are in the database?"* and watch it call your tools.

## What the server exposes

| Tool | Description |
|------|-------------|
| `list_tables` | Get all table names in the database |
| `describe_table` | Get columns and types for a specific table |
| `run_query` | Execute a read-only SELECT query (safety-checked) |

## Key teaching moment

Open Claude Desktop and ask a database question **without writing any agent code**.
Claude itself becomes the agent — it calls `list_tables`, then `describe_table`, then `run_query`.
The MCP protocol handles everything.

This is the difference between building a tool and building an agent:
- Your MCP server = the tool (stateless, reusable, protocol-compliant)
- Claude Desktop / your agents = the orchestrator (decides when and how to use the tool)

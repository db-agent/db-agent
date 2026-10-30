// gateway/mcpServer.js: the MCP wiring (tool schemas, stdio and streamable HTTP transports).
// All behavior lives in core.js; this file only maps requests to it.

import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const TOOLS = [
  {
    name: "list_tables",
    description: "List the tables this caller is allowed to query.",
    inputSchema: {},
  },
  {
    name: "describe_table",
    description: "Columns and types of one table, with business descriptions from the knowledge file when there are any.",
    inputSchema: { table: z.string().describe("Table name from list_tables") },
  },
  {
    name: "ask",
    description:
      "Answer a question in plain language: db-agent writes a read-only SQL query, checks its cost, and runs it. " +
      "Returns the SQL, the rows and the cost estimate. If the query is expensive it is held and returns an approval id.",
    inputSchema: {
      question: z.string().optional().describe("The question to answer"),
      approval_id: z.string().optional().describe("Approval id from an earlier 'Needs approval' reply, once an approver approved it"),
    },
  },
  {
    name: "run_sql",
    description:
      "Run a SELECT you wrote. It still goes through the read-only check, the table policy and the cost guard. " +
      "Expensive queries are held and return an approval id.",
    inputSchema: {
      sql: z.string().optional().describe("A single SELECT or WITH statement"),
      approval_id: z.string().optional().describe("Approval id from an earlier 'Needs approval' reply, once an approver approved it"),
    },
  },
  {
    name: "explain_cost",
    description: "Estimate the data scanned and cost of a SELECT without running it, and say whether it would need approval.",
    inputSchema: { sql: z.string().describe("A single SELECT or WITH statement") },
  },
];

// One MCP server per caller: the caller is fixed for the life of the connection.
export function buildMcpServer(gateway, caller) {
  const server = new McpServer({ name: "db-agent", version: "0.1.0" });
  for (const t of TOOLS) {
    server.registerTool(t.name, { description: t.description, inputSchema: t.inputSchema }, async (args) => {
      const { isError, text } = await gateway.call(caller, t.name, args);
      return { content: [{ type: "text", text }], isError };
    });
  }
  return server;
}

// stdio: the AI tool launches this process, so one process is one caller. The key comes from the
// environment the tool passes in (DB_AGENT_API_KEY). Returns false (and has logged the rejection)
// if the key is not accepted.
export async function serveStdio(gateway, apiKey) {
  const caller = gateway.authenticate(apiKey, "mcp-stdio");
  if (!caller) return false;
  const server = buildMcpServer(gateway, caller);
  await server.connect(new StdioServerTransport());
  return caller;
}

function presentedKey(req) {
  const auth = req.headers.authorization;
  if (typeof auth === "string" && /^bearer\s+/i.test(auth)) return auth.replace(/^bearer\s+/i, "").trim();
  const header = req.headers["x-api-key"];
  return typeof header === "string" ? header.trim() : null;
}

// Streamable HTTP, stateless: every request is authenticated on its own, so each one is attributed
// to the key it carried.
export function createHttpApp(gateway) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  const rpcError = (res, status, code, message) =>
    res.status(status).json({ jsonrpc: "2.0", error: { code, message }, id: null });

  app.post("/mcp", async (req, res) => {
    const caller = gateway.authenticate(presentedKey(req), "mcp-http");
    if (!caller) return rpcError(res, 401, -32001, "Invalid or missing API key");
    const server = buildMcpServer(gateway, caller);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (exc) {
      if (!res.headersSent) rpcError(res, 500, -32603, "Internal server error");
    }
  });

  // Stateless server: no GET streams and no sessions to delete.
  const notAllowed = (_req, res) => rpcError(res, 405, -32000, "Method not allowed");
  app.get("/mcp", notAllowed);
  app.delete("/mcp", notAllowed);

  return app;
}

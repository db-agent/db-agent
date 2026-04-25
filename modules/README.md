# Learning Modules

Work through these modules in order. Each one builds on the last.

```
modules/
├── 01_llm_basics/        ← What is an LLM API call?
├── 02_structured_output/ ← How do we get reliable JSON from an LLM?
├── 03_tool_use/          ← How does the LLM call tools / functions?
├── 04_agentic_loop/      ← How does an agent retry, reflect, and recover?
└── 05_mcp_server/        ← What is MCP? Build a server in 50 lines.
```

Every module is a **single Databricks notebook** — no local install, no `.env`, no laptop dependencies. Designed for the **Databricks free tier**.

## Setup (once)

1. Sign up for a free Databricks workspace at https://www.databricks.com/try.
2. Create a [GitHub Models token](https://github.com/settings/tokens) (default scopes are fine — it's free).
3. Import this folder into Databricks (Workspace → Import → Git or upload).

## How each notebook is structured

Every notebook follows the same pattern:

1. **Step 1** — `%pip install` what's needed and restart Python.
2. **Step 2** — Databricks widgets at the top (`API_KEY`, `BASE_URL`, `MODEL`, plus `CATALOG`/`SCHEMA` for the DB-backed modules). No secrets in code.
3. **Step 3+** — Teaching content, top-to-bottom.

## Data

Modules 03–05 use Databricks' built-in `samples` catalog (`bakehouse`, `nyctaxi`, `accuweather`, `tpch`, …). The agent introspects whatever schema you point the widgets at — change `SCHEMA` and re-run to try a different domain.

## The big picture

The existing `streamlit_app/` is the **finished product** — a complete text-to-SQL pipeline.
These modules show you how to build it from scratch, concept by concept:

| Module | Concept | Key question answered |
|--------|---------|----------------------|
| 01 | LLM API call | How do I talk to a language model? |
| 02 | Structured output | How do I get back JSON I can actually use? |
| 03 | Tool use | How does the LLM decide *what to do* instead of *what to say*? |
| 04 | Agentic loop | How does an agent try again when something goes wrong? |
| 05 | MCP server | How do I expose my tools to *any* LLM client, not just my own code? |

See [CONCEPTS.md](../CONCEPTS.md) for a plain-English glossary of every term used across modules.

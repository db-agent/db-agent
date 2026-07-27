# DB Agent — Text-to-SQL AI Agent for Databricks, Snowflake, and AWS

> An open-source **text-to-SQL AI agent** that converts natural language into safe SQL, with production deployment patterns for **Databricks**, **Snowflake**, and **AWS Lambda**. Schema-aware prompt engineering, SQL safety guardrails (SELECT-only validation), and three reference implementations you can deploy at work.

---

[![Demo Video](https://img.shields.io/badge/Visit-Our%20Demo-red)](https://youtu.be/tt0oTIrY260)
[![Streamlit Live App](https://img.shields.io/badge/Live-App-brightgreen)](https://db-agent.streamlit.app/)

---

**Featured In**

- **AAAI-25 Workshop on Open-Source AI for Mainstream Use** (Philadelphia, March 2025) — DB Agent presented as a reference implementation for production text-to-SQL agents. [Workshop program](https://the-ai-alliance.github.io/AAAI-25-Workshop-on-Open-Source-AI-for-Mainstream-Use/program/) · [Paper](./assets/OSAI4MU-25_submission_paper_v2_format.pdf)

---

## What is DB Agent?

DB Agent is a minimal **natural-language-to-SQL system**. A user asks a question in plain English; DB Agent retrieves relevant schema context, prompts an LLM to generate a SQL query, validates the query against a SELECT-only safety layer, executes it against the target database, and returns the results with every intermediate step visible. It ships with two reference deployments — a generic Streamlit app and a native Databricks App with Unity Catalog integration — so teams can pick the pattern that matches their environment.

---
## Features

- **Text-to-SQL** — natural language to SELECT queries via any LLM
- **Safety layer** — blocks all write/admin SQL before it reaches the database
- **Explainability** — schema context, generated SQL, and validation all visible
- **Any OpenAI-compatible LLM** — OpenAI, GitHub Models, Groq, Ollama, LM Studio
- **Any SQL database** — SQLite by default; PostgreSQL, MySQL, Lakebase, Unity Catalog via one env var
- **Agentic Memory** — Cross agent memory and context awareness to suggest queries, best usecase OLTP, OLAP
---


## Deployment modes

The primary implementation is the Node.js/React app in [`nodejs-app/`](./nodejs-app) — spin it up locally in one command, or deploy it straight to Databricks Apps.

**Run it locally** (SQLite + local Ollama, no API key needed):

```bash
cd nodejs-app
ollama pull qwen2.5-coder:7b
./run_local.sh
```

Open http://localhost:3001. Any OpenAI-compatible endpoint works instead of Ollama — see [`nodejs-app/.env.example`](./nodejs-app/.env.example) for OpenAI, Groq, and Databricks Model Serving.

**Deploy to Databricks Apps:**

```bash
cd nodejs-app
databricks apps create db-agent-node --description "DB Agent"
databricks sync . /Workspace/Users/<you>/db-agent-node \
  --exclude "node_modules/**" --exclude "web/node_modules/**" --exclude "web/dist/**"
databricks apps deploy db-agent-node --source-code-path /Workspace/Users/<you>/db-agent-node
```

Databricks installs dependencies and builds the frontend automatically. See [`nodejs-app/README.md`](./nodejs-app/README.md) for `app.yaml` configuration (LLM endpoint, secrets, embeddings model for the memory feature).

An earlier Python/Streamlit implementation is preserved under [`legacy/streamlit-app/`](./legacy/streamlit-app) for reference — see its README for how to run it.

**Running multiple instances** (for cross-agent memory — see Agentic Memory above): each running instance is tagged via `DBAGENT_ID`, so you can spin up as many as you like, locally or on Databricks, and they'll share suggestions with each other through a common memory store.

```bash
# Instance 1 — e.g. an OLTP-facing agent, local Ollama
DBAGENT_ID=oltp-sqlserver ./run_local.sh

# Instance 2 — e.g. an OLAP-facing agent, same or a different machine
DBAGENT_ID=olap-databricks PORT=3002 ./run_local.sh
```

By default each instance stores memory in its own local file, so two local instances only share memory if pointed at the same `MEMORY_STORE_PATH`. To share memory across genuinely separate machines/deployments (e.g. one instance local, one on Databricks Apps), set `MEMORY_BACKEND=s3vectors` on every instance that should share — see [`nodejs-app/README.md`](./nodejs-app/README.md) for the S3 Vectors setup, including the important detail that every sharing instance must use the *same embedding model* (chat/SQL-generation models can still differ freely per instance).

---


## Learning modules

New to AI agents? Work through the modules in order — each one builds on the last:

| Module | Concept | What you build |
|--------|---------|---------------|
| [01 — LLM Basics](./modules/01_llm_basics/) | What is an LLM API call? | Notebook: raw API call, messages, temperature |
| [02 — Structured Output](./modules/02_structured_output/) | How to get reliable JSON from an LLM | Notebook: JSON mode + Pydantic validation |
| [03 — Tool Use](./modules/03_tool_use/) | LLM calls functions instead of generating text | Agent that decides when to query the DB |
| [04 — Agentic Loop](./modules/04_agentic_loop/) | Retry, reflect, recover from errors | Agent with max-steps guard and error recovery |
| [05 — MCP Server](./modules/05_mcp_server/) | Expose tools via a standard protocol | MCP server connectable to Claude Desktop |


---


## Workshops & Training

The team behind DB Agent teaches production text-to-SQL and Databricks patterns through hands-on bootcamps.

- **Private team workshops** — Virtual workshops on AI Agents, Claude Code, MS Copilot, text-to-SQL agents, SQL safety guardrails, and Databricks deployment patterns. Contact [BeCloudReady](https://calendly.com/kchandank/30-mins-meeting) (Databricks Registered Partner).

Community: [TorontoAI](https://toronto-ai.org/) — 10,000+ data and AI practitioners across Toronto, the GTA, and the US East Coast.

---

## Maintained by

[BeCloudReady](https://becloudready.com/) — Databricks Registered Partner. Organizers of [TorontoAI](https://torontoai.io/).

[Book a discovery call](https://calendly.com/kchandank/30-mins-meeting) for Customized training/consulting engagement 

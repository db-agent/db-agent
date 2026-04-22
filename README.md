# DB Agent — Text-to-SQL AI Agent for Databricks, Snowflake, and AWS

> An open-source **text-to-SQL AI agent** that converts natural language into safe SQL, with production deployment patterns for **Databricks**, **Snowflake**, and **AWS Lambda**. Schema-aware prompt engineering, SQL safety guardrails (SELECT-only validation), and three reference implementations you can deploy at work.

---

[![Demo Video](https://img.shields.io/badge/Visit-Our%20Demo-red)](https://youtu.be/tt0oTIrY260)
[![Streamlit Live App](https://img.shields.io/badge/Live-App-brightgreen)](https://db-agent.streamlit.app/)

---

**Latest News 🔥**

- [4 March 2025] — Presented at the [AAAI-25 Workshop on Open-Source AI for Mainstream Use](https://the-ai-alliance.github.io/AAAI-25-Workshop-on-Open-Source-AI-for-Mainstream-Use/program/) in Philadelphia. Workshop paper available [here](https://drive.google.com/file/d/1oQ83on04XHN6BZKJjdDu90eWK6RprT8X/view?usp=sharing).

---

## What is DB Agent?

DB Agent is a minimal, teachable **natural-language-to-SQL system**. A user asks a question in plain English; DB Agent retrieves relevant schema context, prompts an LLM to generate a SQL query, validates the query against a SELECT-only safety layer, executes it against the target database, and returns the results with every intermediate step visible. It ships with three reference deployments — a Streamlit prototype, a Next.js + FastAPI full-stack app, and a native Databricks App with Unity Catalog integration — so teams can pick the pattern that matches their environment.

---

## Three deployment variants

This repo contains three independent, fully working versions of DB Agent — same agentic pipeline, different deployment targets.

| | [Streamlit App](./streamlit_app/) | [Full-Stack App](./fullstack_app/) | [Databricks App](./databricks_app/) |
|---|---|---|---|
| **Stack** | Python + Streamlit | Next.js + FastAPI | Python + Streamlit (native Databricks App) |
| **Best for** | Rapid prototyping, data teams | Production full-stack demos | Enterprise Databricks deployments |
| **Auth** | `.env` + API keys | `.env` / AWS Secrets Manager | Databricks OAuth service principal |
| **SQL target** | SQLite / Postgres / MySQL | SQLite / Postgres / MySQL | Unity Catalog Delta tables |
| **Deploy on** | Snowflake, Databricks, Docker | AWS (Lambda + API Gateway) | `databricks apps deploy` |

See each folder's README for setup and deployment instructions.

---

## Features

- **Text-to-SQL** — natural language to SELECT queries via any LLM
- **Safety layer** — blocks all write/admin SQL before it reaches the database
- **Explainability** — schema context, generated SQL, and validation all visible
- **Any OpenAI-compatible LLM** — OpenAI, GitHub Models, Groq, Ollama, LM Studio
- **Any SQL database** — SQLite by default; PostgreSQL and MySQL via one env var

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

The `streamlit_app/` is the **finished product** these modules build toward.
See [CONCEPTS.md](./CONCEPTS.md) for a plain-English glossary of every term.

---


## Workshops & Training

The team behind DB Agent teaches production text-to-SQL and Databricks patterns through hands-on bootcamps.

- **[Text-to-SQL AI Agent on Databricks — 2-Hour Hands-On Bootcamp](https://luma.com/2yxvrgm5)** — Saturday, April 25. Build and deploy the DB Agent stack live. Open to data and AI engineers.
- **[Databricks Lakehouse Bootcamp — Build Production Pipelines in One Weekend](https://becloudready.com/programs/databricks-lakehouse-bootcamp)** — 2-day hands-on weekend covering Medallion Architecture (Bronze → Silver → Gold), Delta Lake, Unity Catalog, Databricks AI/BI (Genie), and Lakeflow workflows. Aligned with Databricks Certified Associate Developer exam.
- **Private team workshops** — 1-day on-site or virtual workshops on text-to-SQL agents, SQL safety guardrails, and Databricks deployment patterns. Contact [BeCloudReady](https://becloudready.com/) (Databricks Registered Partner).

Community: [TorontoAI](https://torontoai.io/) — 10,000+ data and AI practitioners across Toronto, the GTA, and the US East Coast.

---

## Maintained by

[BeCloudReady](https://becloudready.com/) — Databricks Registered Partner. Organizers of [TorontoAI](https://torontoai.io/).

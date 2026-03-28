<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/db-agent/db-agent/refs/heads/main/assets/logo.png">
    <img alt="DB Agent" src="https://raw.githubusercontent.com/db-agent/db-agent/refs/heads/main/assets/logo.png" width=55%>
  </picture>
</p>

<h3 align="center">
DB Agent
</h3>

---

[![Docker Image CI](https://github.com/db-agent/db-agent/actions/workflows/docker-image.yml/badge.svg)](https://github.com/db-agent/db-agent/actions/workflows/docker-image.yml)
[![Checkout the Website](https://img.shields.io/badge/Visit-Our%20Website-brightgreen)](https://www.db-agent.com)
[![Demo Video](https://img.shields.io/badge/Visit-Our%20Demo-red)](https://youtu.be/tt0oTIrY260)
[![Denvr Cloud](https://img.shields.io/badge/Deploy%20On-Denvr%20Cloud-brightgreen)](https://console.cloud.denvrdata.com/account/login)
[![Live App](https://img.shields.io/badge/Live-App-brightgreen)](https://db-agent.streamlit.app/)

---

**Latest News 🔥**

- [4 March 2025] — Presented at the [AAAI-25 Workshop on Open-Source AI for Mainstream Use](https://the-ai-alliance.github.io/AAAI-25-Workshop-on-Open-Source-AI-for-Mainstream-Use/program/) in Philadelphia. Workshop paper available [here](https://drive.google.com/file/d/1oQ83on04XHN6BZKJjdDu90eWK6RprT8X/view?usp=sharing).

---

A minimal, teachable **natural-language-to-SQL** system. Ask questions in plain English — DB Agent generates the SQL, validates it for safety, executes it, and shows you every step.

## Features

- **Text-to-SQL** — converts natural language to SELECT queries via any LLM
- **Safety layer** — blocks all write/admin SQL before it reaches the database
- **Explainability** — schema context, generated SQL, and validation result all visible in the UI
- **Any OpenAI-compatible API** — works with GitHub Models, OpenAI, Groq, Ollama, LM Studio, and more
- **Any SQL database** — SQLite by default; swap to PostgreSQL, MySQL, etc. via one env var
- **Docker support** — runs anywhere with a single command

## Quick start

```bash
git clone https://github.com/db-agent/db-agent.git
cd db-agent

pip install -r requirements.txt

# Seed the demo SQLite database (customers / products / orders)
python scripts/seed_demo_data.py

# Copy and fill in your LLM credentials
cp .env.example .env

streamlit run app/streamlit_app.py
```

Open [http://localhost:8501](http://localhost:8501).

## LLM configuration

Set these in `.env` or enter them directly in the sidebar at runtime:

| Provider | `LLM_BASE_URL` | `LLM_MODEL` | Notes |
|---|---|---|---|
| **GitHub Models** | `https://models.inference.ai.azure.com` | `gpt-4o-mini` | Free tier available with a GitHub account |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` | Requires API key |
| Groq | `https://api.groq.com/openai/v1` | `llama-3.1-8b-instant` | Free tier available |
| Ollama (local) | `http://localhost:11434/v1` | `llama3.2` | No key required |
| LM Studio | `http://localhost:1234/v1` | *(model from UI)* | No key required |

**GitHub Models** is the recommended free option — create a token at [github.com/settings/tokens](https://github.com/settings/tokens) (no special scopes needed) and use it as your `LLM_API_KEY`.

## Database configuration

```env
# SQLite (default — zero infrastructure)
DB_URL=sqlite:///./data/demo.db

# PostgreSQL
DB_URL=postgresql://user:password@localhost:5432/mydb

# MySQL
DB_URL=mysql+pymysql://user:password@localhost:3306/mydb
```

## Architecture

```
app/
├── streamlit_app.py  ← UI: renders every pipeline stage
├── config.py         ← env vars (DB_URL, LLM_*)
├── pipeline.py       ← orchestration: question → result  ★ start here
├── models.py         ← Pydantic types: LLMConfig, SQLResponse, PipelineOutput
├── prompts.py        ← system prompt + schema-aware user prompt builder
├── llm.py            ← OpenAI-compatible client + structured output parser
├── db.py             ← SQLAlchemy: schema inspection + query execution
└── sql_safety.py     ← guardrail: allow only safe SELECT statements
```

Data flow:

```
question → build_user_prompt() → call_llm() → parse_sql_response()
         → validate_sql() → run_query() → PipelineOutput → UI
```

## Docker

```bash
docker build -t db-agent .
docker run -p 8501:8501 -e LLM_API_KEY=<your-key> db-agent
```

## Tests

```bash
pytest tests/ -v
```

## Example queries (demo database)

| Question | What it shows |
|---|---|
| How many customers are there? | COUNT aggregate |
| Show the top 5 products by price | ORDER BY + LIMIT |
| List all orders placed in 2024 | WHERE with date filter |
| Which customers have placed the most orders? | JOIN + GROUP BY |
| What is the total revenue per product? | JOIN + SUM |
| Drop the customers table | Safety block — rejected |

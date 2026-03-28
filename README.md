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

---

## Two versions

This repo contains two independent, fully working versions of DB Agent — same concept, different deployment targets.

| | [Streamlit App](./streamlit_app/) | [Full-Stack App](./fullstack_app/) |
|---|---|---|
| **Stack** | Python + Streamlit | Next.js + FastAPI |
| **Best for** | Rapid prototyping, data teams | Production deployments, enterprise demos |
| **Deploy on** | Snowflake, Databricks, Docker | AWS (Lambda + API Gateway), Neo Cloud |

See each folder's README for setup and deployment instructions.

---

## Features

- **Text-to-SQL** — natural language to SELECT queries via any LLM
- **Safety layer** — blocks all write/admin SQL before it reaches the database
- **Explainability** — schema context, generated SQL, and validation all visible
- **Any OpenAI-compatible LLM** — OpenAI, GitHub Models, Groq, Ollama, LM Studio
- **Any SQL database** — SQLite by default; PostgreSQL and MySQL via one env var

---

## Repository structure

```
db-agent/
├── streamlit_app/     ← Streamlit version (Snowflake / Databricks / Docker)
├── fullstack_app/     ← Full-stack version (AWS / Neo Cloud)
├── scripts/           ← shared utilities
└── tests/             ← shared test suite
```

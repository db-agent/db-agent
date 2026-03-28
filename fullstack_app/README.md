# DB-Agent — Full-Stack Edition

A modern, full-stack natural-language-to-SQL AI application built with **Next.js** (frontend) and **Python/FastAPI** (backend), designed for AWS Lambda + API Gateway deployment.

> **This is the full-stack version.** The original Streamlit prototype lives in [`../streamlit_app/`](../streamlit_app/).

---

## What it does

1. User types a plain-English question
2. Backend inspects the database schema
3. An LLM generates a safe SQL query
4. SQL is validated for safety (SELECT only, no DDL)
5. The query executes and results are returned
6. Frontend displays SQL, explanation, validation status, and results

---

## Architecture

```
+----------------------------------------------------------------+
|  Browser                                                       |
|  +---------------------------------------------------------+  |
|  |  Next.js App (TypeScript + Tailwind CSS)                |  |
|  |  +----------+  +--------------+  +------------------+  |  |
|  |  | Sidebar  |  | QueryInput   |  | ResultsTable     |  |  |
|  |  | Schema   |  | SqlPanel     |  | ValidationBadge  |  |  |
|  |  | Browser  |  | Explanation  |  | ExamplePrompts   |  |  |
|  |  +----------+  +--------------+  +------------------+  |  |
|  +---------------------------------------------------------+  |
+------------------------------+---------------------------------+
                               | HTTP (JSON)
                               v
+----------------------------------------------------------------+
|  API Gateway (HTTP API)                                        |
|  GET /health  .  GET /schema  .  POST /query                  |
+------------------------------+---------------------------------+
                               |
                               v
+----------------------------------------------------------------+
|  AWS Lambda (Python 3.11 + FastAPI + Mangum)                  |
|                                                                |
|  pipeline.py                                                   |
|  +-- prompts.py      <- schema-aware prompt construction      |
|  +-- llm.py          <- OpenAI-compatible LLM call            |
|  +-- sql_safety.py   <- SELECT-only validation                |
|  +-- db.py           <- SQLAlchemy query execution            |
+------------------------------+---------------------------------+
                               |
               +---------------+---------------+
               v                               v
      SQLite / PostgreSQL              OpenAI / Groq /
      (via SQLAlchemy)                 Ollama / LM Studio
```

---

## Project structure

```
fullstack_app/
+-- frontend/                  # Next.js App Router
|   +-- app/                   # Pages and layouts
|   +-- components/            # React components
|   +-- lib/                   # API client and types
|   +-- package.json
|   +-- tailwind.config.ts
+-- backend/                   # Python FastAPI
|   +-- app/                   # Core modules
|   |   +-- config.py          # Environment config
|   |   +-- models.py          # Pydantic models (API contract)
|   |   +-- prompts.py         # LLM prompt construction
|   |   +-- llm.py             # LLM API wrapper
|   |   +-- db.py              # Database layer
|   |   +-- sql_safety.py      # SQL validation
|   |   +-- pipeline.py        # Orchestration
|   +-- handlers/              # Individual Lambda handlers
|   +-- main.py                # FastAPI app + Mangum adapter
|   +-- requirements.txt
|   +-- tests/
+-- scripts/
|   +-- seed_demo_data.py      # Initialize demo database
+-- data/                      # SQLite database (gitignored)
+-- template.yaml              # AWS SAM deployment
+-- .env.example               # Environment variable template
+-- TEACHING.md                # Workshop and bootcamp guide
+-- README.md                  # This file
```

---

## Local development

### Prerequisites

- Python 3.11+
- Node.js 18+
- An LLM API key (OpenAI, Groq, GitHub Models) **or** Ollama running locally

### 1. Backend setup

```bash
cd fullstack_app/backend

# Create virtual environment
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Copy and edit environment variables
cp ../.env.example .env
# Edit .env — set LLM_API_KEY and LLM_MODEL at minimum

# Seed the demo database
cd ..
python scripts/seed_demo_data.py

# Start the backend
cd backend
uvicorn main:app --reload --port 8000
```

Backend will be available at:
- API: `http://localhost:8000`
- Interactive docs: `http://localhost:8000/docs`
- Health: `http://localhost:8000/health`

### 2. Frontend setup

```bash
cd fullstack_app/frontend

# Install dependencies
npm install

# Set backend URL (optional — defaults to localhost:8000 via Next.js rewrite)
echo "NEXT_PUBLIC_API_URL=http://localhost:8000" > .env.local

# Start the frontend
npm run dev
```

Frontend will be available at `http://localhost:3000`.

### 3. Run backend tests

```bash
cd fullstack_app/backend
pytest tests/ -v
```

---

## Environment variables

| Variable | Description | Default |
|---|---|---|
| `DB_URL` | SQLAlchemy database URL | `sqlite:///./data/demo.db` |
| `LLM_BASE_URL` | OpenAI-compatible API base URL | `https://api.openai.com/v1` |
| `LLM_API_KEY` | API key for the LLM provider | *(required)* |
| `LLM_MODEL` | Model name | `gpt-4o-mini` |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins | `http://localhost:3000` |

Frontend:

| Variable | Description | Default |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | Backend API base URL | `http://localhost:8000` |

---

## API reference

### `GET /health`
Returns database connectivity status.

### `GET /schema`
Returns all tables and columns from the connected database.

### `POST /query`
Runs the full NL-to-SQL pipeline.

**Request:**
```json
{
  "question": "Show total revenue by product category",
  "limit": 100
}
```

**Response:**
```json
{
  "question": "Show total revenue by product category",
  "schema_context": "customers(id, name) | products(id, name, category, price) | orders(...)",
  "sql": "SELECT p.category, SUM(p.price * o.quantity) AS revenue FROM ...",
  "validation": { "is_valid": true, "errors": [] },
  "explanation": "This query joins orders with products to calculate revenue per category.",
  "rows": [{ "category": "Electronics", "revenue": 2189.92 }],
  "row_count": 3,
  "timings": { "llm_ms": 312, "validation_ms": 2, "execution_ms": 14, "total_ms": 330 },
  "error": null
}
```

---

## AWS deployment

### Prerequisites
- AWS CLI configured
- AWS SAM CLI installed (`pip install aws-sam-cli`)
- Parameters stored in AWS SSM / Secrets Manager

### Deploy

```bash
cd fullstack_app

# Build Lambda packages
sam build

# First deploy (interactive)
sam deploy --guided

# Subsequent deploys
sam deploy
```

SAM will output the API Gateway URL. Set this as `NEXT_PUBLIC_API_URL` in your frontend deployment.

### Frontend hosting options

| Option | Best for |
|---|---|
| **Vercel** | Easiest — connect GitHub repo, auto-deploys |
| **AWS Amplify** | Stays within AWS ecosystem |
| **S3 + CloudFront** | Maximum control, lowest cost |
| **App Runner** | SSR support without complexity |

For static export (no SSR needed): `npm run build` then deploy `out/` to S3.

---

## LLM provider support

Any OpenAI-compatible provider works. Set `LLM_BASE_URL`, `LLM_API_KEY`, and `LLM_MODEL`:

| Provider | Base URL | Notes |
|---|---|---|
| OpenAI | `https://api.openai.com/v1` | Recommended for production |
| GitHub Models | `https://models.inference.ai.azure.com` | Free tier available |
| Groq | `https://api.groq.com/openai/v1` | Very fast inference |
| Ollama | `http://localhost:11434/v1` | Fully local, no cost |
| LM Studio | `http://localhost:1234/v1` | Local with GUI |

---

## Enterprise deployment notes

This reference implementation omits auth and multi-tenancy intentionally.
In an enterprise deployment, add:

1. **Authentication** — API Gateway + Cognito Authorizer or Lambda authorizer (JWT)
2. **Database** — Amazon RDS (PostgreSQL) via RDS Proxy for connection pooling in Lambda
3. **Secrets** — AWS Secrets Manager for LLM API keys; SSM Parameter Store for config
4. **Network** — Place Lambda in VPC; use VPC endpoints for private RDS access
5. **Observability** — Enable X-Ray tracing, CloudWatch dashboards, custom metrics
6. **Rate limiting** — API Gateway usage plans + API keys per tenant

See [TEACHING.md](./TEACHING.md) for a detailed architecture walkthrough.

---

## Extension ideas

- **Query history** — Store recent questions in localStorage or DynamoDB
- **Chart output** — Detect numeric results and render bar/line charts
- **Multi-database** — Support switching between multiple DB connections
- **Streaming** — Stream LLM responses via Server-Sent Events
- **Export** — Add CSV/JSON download for query results
- **Prompt lab** — Expose a prompt editor for experimentation
- **Auth layer** — Add Cognito for multi-user access
- **Audit log** — Store all queries, validations, and results to S3

---

## Related

- [Streamlit prototype](../streamlit_app/) — The original single-file prototype
- [TEACHING.md](./TEACHING.md) — Workshop and bootcamp guide

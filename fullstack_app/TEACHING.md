# Teaching Guide — DB-Agent Full-Stack

This guide is for instructors, workshop leads, and engineers using this project to teach modern full-stack AI application development.

---

## What this project teaches

| Topic | Where in the code |
|---|---|
| Full-stack separation | `frontend/` vs `backend/` directories |
| API contract design | `backend/app/models.py` (Pydantic) |
| Serverless deployment | `template.yaml`, `backend/main.py` (Mangum) |
| Safe text-to-SQL | `backend/app/sql_safety.py`, `pipeline.py` |
| Prompt engineering | `backend/app/prompts.py` |
| LLM abstraction | `backend/app/llm.py` |
| React component design | `frontend/components/` |
| Enterprise UI patterns | `AppShell`, `Sidebar`, `QueryWorkspace` |

---

## Module 1 — Architecture walkthrough (30 min)

### Goal
Students understand how the application is structured and why each layer exists.

### Talking points

1. **Frontend/backend split**
   - Frontend = Next.js, TypeScript, Tailwind — runs in the browser
   - Backend = Python, FastAPI — runs on a server (or Lambda)
   - They communicate only through the HTTP API (`/health`, `/schema`, `/query`)
   - This is the foundation of every modern web application

2. **Why FastAPI?**
   - Type-safe request/response with Pydantic
   - Auto-generated OpenAPI docs at `/docs`
   - Works locally with `uvicorn`, deploys to Lambda via Mangum

3. **Why Mangum?**
   - AWS Lambda expects a specific event/context signature
   - Mangum adapts your ASGI app (FastAPI) to that protocol
   - Zero code changes needed — same app runs locally and on Lambda

### Exercise
Draw the request flow on a whiteboard:
```
User types question
  -> React component calls fetch("/api/query")
  -> Next.js rewrites to http://localhost:8000/query
  -> FastAPI receives POST /query
  -> pipeline.py runs 6 stages
  -> JSON response returned
  -> React renders results
```

---

## Module 2 — The pipeline (45 min)

### Goal
Students understand how a text-to-SQL system works end to end.

### Walk through `backend/app/pipeline.py` line by line

Show each stage and explain:
1. **Schema inspection** — why we inject schema per-call (not static)
2. **Prompt construction** — show `prompts.py` side by side
3. **LLM call** — how the OpenAI SDK works, what temperature=0 does
4. **SQL parsing** — why we need defensive JSON parsing
5. **Validation** — the security boundary. Never skip this.
6. **Execution** — why we wrap in a subquery for safe LIMIT

### Key teaching moment: the safety boundary

Open `sql_safety.py`. Ask students:
> What happens if the LLM generates `DROP TABLE orders`?

Walk through the validation logic. Show that:
- The query never reaches the database
- The API returns a clear validation failure
- The frontend shows the error visibly

### Exercise
Ask students to write a test case for a new forbidden keyword (`VACUUM`). What file do they edit? What test do they write?

---

## Module 3 — Frontend architecture (45 min)

### Goal
Students can read and extend the React component tree.

### Component hierarchy walkthrough

```
page.tsx                  <- loads schema, manages top-level state
+-- AppShell              <- layout: header + sidebar + main
    +-- Header             <- branding, nav links
    +-- Sidebar            <- schema browser (collapsible tables)
    +-- QueryWorkspace     <- all query logic
        +-- QueryInput     <- textarea + submit button
        +-- ExamplePrompts <- pre-built questions
        +-- ValidationBadge<- pass/fail with error list
        +-- SqlPanel       <- dark code block + copy button
        +-- ExplanationPanel <- LLM plain-English explanation
        +-- ResultsTable   <- responsive data table
```

### Key React patterns to highlight

- `useState` for local state (loading, result, error)
- `useEffect` for data fetching on mount
- Props for data flow (parent -> child)
- Callback props for events (child -> parent via `onSubmit`)
- Loading/error/empty states in every component

### Exercise
Add a "History" panel that stores the last 5 questions in `localStorage`. Which component does this logic belong in? Where should the state live?

---

## Module 4 — AWS Lambda deployment (60 min)

### Goal
Students understand serverless deployment and can explain it to non-engineers.

### Talking points

1. **What is Lambda?**
   - A function in the cloud that runs when called
   - You don't manage servers — AWS does
   - You pay per invocation, not per hour

2. **What is API Gateway?**
   - The front door to your Lambda functions
   - Routes HTTP requests to the right function
   - Handles CORS, auth headers, throttling

3. **What is SAM?**
   - AWS Serverless Application Model
   - A YAML template that describes your serverless app
   - `sam build` + `sam deploy` deploys everything

4. **Walk through template.yaml**
   - Show the three functions (health, schema, query)
   - Show the API Gateway routes
   - Show environment variable injection from SSM/Secrets Manager

### Architecture diagram

```
+-----------------------------------------------------+
|                   AWS Cloud                         |
|                                                     |
|  S3 + CloudFront        API Gateway (HTTP API)      |
|  +--------------+       +----------------------+    |
|  |  Next.js     |------>|  GET  /health        |-->  Lambda (128MB)
|  |  static site |       |  GET  /schema        |-->  Lambda (512MB)
|  +--------------+       |  POST /query         |-->  Lambda (1GB)
|                         +----------------------+    |
|                                    |                |
|                                    v                |
|                         +----------------------+    |
|                         |  RDS (PostgreSQL)    |    |
|                         |  or EFS-mounted      |    |
|                         |  SQLite              |    |
|                         +----------------------+    |
+-----------------------------------------------------+
```

### Key questions to ask students

- Why are health/schema/query separate Lambda functions?
- What happens if the query Lambda has a bug — does health break?
- Why does query get more memory than health?
- Where would you add authentication in this diagram?

### Exercise
Ask students to add a fourth endpoint: `GET /tables/{table_name}/preview` that returns the first 5 rows of a table. They should:
1. Add the route to `main.py`
2. Add a handler function
3. Add the route to `template.yaml`
4. Add a button in the frontend Sidebar

---

## Module 5 — Enterprise deployment discussion (30 min)

### Topics

1. **Authentication options**
   - Cognito User Pools (managed auth)
   - API Gateway authorizers (JWT validation)
   - Where to add it: API Gateway layer, not application layer

2. **Database connectivity**
   - Lambda -> RDS via VPC
   - Lambda -> RDS Proxy (connection pooling)
   - Lambda -> DynamoDB (if NoSQL is acceptable)

3. **Secrets management**
   - Never hardcode API keys
   - AWS Secrets Manager for LLM API keys
   - SSM Parameter Store for config values

4. **Observability**
   - CloudWatch Logs (automatic for Lambda)
   - X-Ray tracing (add to template.yaml)
   - Custom metrics for query latency and validation failures

5. **Cost estimation**
   - Lambda: first 1M requests/month free
   - API Gateway HTTP API: $1 per million requests
   - For a demo/bootcamp tool: effectively free

---

## Suggested bootcamp schedule

| Session | Duration | Content |
|---|---|---|
| 1 | 90 min | Architecture walkthrough + pipeline deep dive |
| 2 | 90 min | Frontend component tour + add a feature |
| 3 | 90 min | AWS SAM deployment + architecture diagram |
| 4 | 60 min | Enterprise patterns discussion + extension ideas |

---

## Extension ideas for students

- Add query history with localStorage
- Add a "Copy result as CSV" button
- Add chart visualisation using Recharts
- Add support for multiple database connections
- Add a prompt editor panel
- Add rate limiting to the API
- Deploy to real AWS and share the URL
- Add streaming for LLM responses (Server-Sent Events)
- Add authentication with Cognito
- Replace SQLite with PostgreSQL on RDS

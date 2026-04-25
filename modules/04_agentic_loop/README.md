# Module 04 — Agentic Loop

**Concept:** How does an agent recover from errors, reflect on its work, and know when to stop?

Open [`agentic_loop.ipynb`](agentic_loop.ipynb) in a Databricks workspace (the free tier is enough) and run the cells top-to-bottom.

## What's new vs Module 03

| Feature | Module 03 | Module 04 |
|---------|-----------|-----------|
| Tool calling | ✓ | ✓ |
| Error recovery (retry on bad SQL) | Partial | ✓ Full |
| Max-steps guard | ✗ | ✓ |
| Step-by-step reasoning log | Basic | Verbose |
| Multi-question memory | ✗ | ✓ |
| ReAct-style prompt | ✗ | ✓ |

## Setup

1. Import `agentic_loop.ipynb` into Databricks.
2. Attach to any cluster or serverless compute.
3. Run the first cell — installs `openai` and restarts Python.
4. Fill the widgets at the top:
   - `API_KEY` — your [GitHub Models token](https://github.com/settings/tokens)
   - `CATALOG` / `SCHEMA` — defaults to `samples` / `bakehouse`; switch to `nyctaxi`, `accuweather`, or `tpch` to try a different domain
5. Run the remaining cells.

## Key teaching moments

1. **Error recovery** — Step 9 deliberately references columns that don't exist. Watch the agent read the DB error, fix the SQL, and retry.
2. **Max steps** — Without a limit, a confused agent can loop forever. `MAX_STEPS = 8` is the guardrail.
3. **Memory across questions** — Calling `chat(...)` in sequential cells lets the agent reference prior answers ("now show me the same thing for that table").
4. **ReAct** — The system prompt tells the model to think before acting; this boosts reliability on multi-step questions.

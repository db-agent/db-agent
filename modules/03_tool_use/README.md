# Module 03 — Tool Use

**Concept:** Instead of generating text, the LLM *calls functions* and decides what data to fetch.

Open [`tool_use.ipynb`](tool_use.ipynb) in a Databricks workspace (the free tier is enough) and run the cells top-to-bottom.

## The shift

In a hard-coded pipeline, **you** decide the flow:

```
schema → prompt → LLM → parse → validate → execute
```

With tool use, the LLM decides:

```
question → LLM sees tools → calls get_schema() → calls run_query(sql=...) → writes answer
```

## Setup

1. Import `tool_use.ipynb` into Databricks.
2. Attach to any cluster or serverless compute.
3. Run the first cell — installs `openai` and restarts Python.
4. Fill the widgets at the top:
   - `API_KEY` — your [GitHub Models token](https://github.com/settings/tokens)
   - `CATALOG` — defaults to `samples`
   - `SCHEMA` — defaults to `bakehouse` (try `nyctaxi`, `accuweather`, or `tpch` for variety)
5. Run the remaining cells. The notebook talks to Databricks' built-in `samples` catalog — no data setup needed.

## What to look at

1. `TOOLS` — the JSON schema that tells the LLM what functions exist
2. `run_tool()` — your code that actually executes when the LLM makes a call
3. The `while` loop — how multi-step tool use works
4. `validate_sql()` — the safety guardrail that blocks writes

## Key teaching moment

The LLM doesn't know the database schema until it calls `get_schema()`. It decides to call that tool **on its own** — the developer never said "first get the schema".

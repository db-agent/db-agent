# Module 03 — Tool Use

**Concept:** Instead of generating text, the LLM *calls functions* and decides what data to fetch.

## The shift

In the DB Agent's fixed pipeline (`streamlit_app/pipeline.py`), the developer hard-codes every step:
```
schema → prompt → LLM → parse → validate → execute
```
The LLM only fills in the SQL. **You** decide the flow.

With tool use, you hand the LLM a list of available functions. **The LLM decides:**
- Which function to call
- When to call it
- What arguments to pass

```
question → LLM sees tools → calls get_schema() → calls run_query(sql=...) → writes answer
```

## Run it

```bash
cd /path/to/db-agent
python modules/03_tool_use/agent.py
# or with your own question:
python modules/03_tool_use/agent.py "How many products are in each category?"
```

## What to look at

1. `TOOLS` list — the JSON schema that tells the LLM what functions exist
2. `run_tool()` — your code that actually executes when the LLM makes a call
3. The `while finish_reason == "tool_calls"` loop — how multi-step tool use works
4. Compare to `streamlit_app/pipeline.py` — same result, but the LLM is now driving

## Key teaching moment

The LLM doesn't know the database schema until it calls `get_schema()`.
It decides to call that tool **on its own**, then uses the result to write the SQL.
The developer never told it "first get the schema" — the LLM figured that out.

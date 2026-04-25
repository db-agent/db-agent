# Module 02 — Structured Output

**Concept:** How do we get reliable, machine-readable JSON from an LLM?

Open [`structured_output.ipynb`](structured_output.ipynb) in a Databricks workspace (the free tier is enough) and run the cells top-to-bottom.

## What you'll learn

- Why free-form LLM output breaks production code
- How to ask for JSON via the system prompt (prompt engineering)
- How to use JSON mode (`response_format`) for guaranteed valid JSON
- How to use Pydantic to validate the JSON matches your expected schema
- How to defensively parse real-world LLM output

## Setup

1. Import `structured_output.ipynb` into your Databricks workspace.
2. Attach it to any cluster or serverless compute.
3. Run the first cell — it installs `openai` + `pydantic` and restarts Python.
4. Fill in the `API_KEY` widget with your [GitHub Models token](https://github.com/settings/tokens).
5. Run the remaining cells.

## Key takeaway

```
LLM(prompt) → raw text      ← fragile
LLM(prompt) + JSON mode → {"sql": "...", "explanation": "..."}  ← robust
Pydantic(json) → SQLResponse(sql="...", explanation="...")      ← typed + validated
```

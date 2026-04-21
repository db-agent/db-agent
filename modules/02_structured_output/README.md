# Module 02 — Structured Output

**Concept:** How do we get reliable, machine-readable JSON from an LLM?

Open `notebook.ipynb` and run every cell top to bottom.

## What you'll learn

- Why free-form LLM output breaks production code
- How to ask for JSON via the system prompt (prompt engineering)
- How to use JSON mode (`response_format`) for guaranteed valid JSON
- How to use Pydantic to validate the JSON matches your expected schema

## Prerequisites

```bash
pip install openai pydantic python-dotenv
```

## Key takeaway

LLM output is text by default — and text is unparseable at scale.
Structured output is the foundation of every reliable AI application:

```
LLM(prompt) → raw text      ← fragile
LLM(prompt) + JSON mode → {"sql": "...", "explanation": "..."}  ← robust
Pydantic(json) → SQLResponse(sql="...", explanation="...")      ← typed + validated
```

This is exactly how `streamlit_app/llm.py` + `streamlit_app/models.py` work.

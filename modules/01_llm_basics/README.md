# Module 01 — LLM Basics

**Concept:** How do you talk to a language model?

Open `notebook.ipynb` and run every cell top to bottom.

## What you'll learn

- The structure of a chat API call (`model`, `messages`, `temperature`)
- The difference between `system`, `user`, and `assistant` roles
- What the raw API response looks like before you parse it
- How `temperature=0` makes responses deterministic

## Prerequisites

**1. Install Ollama** — https://ollama.com (or `brew install ollama` on Mac)

**2. Pull the model and start the server:**
```bash
ollama pull llama3.2:1b   # ~1 GB, one-time download
ollama serve              # keep this running in a separate terminal
```

**3. Install Python deps:**
```bash
pip install openai python-dotenv
```

No API key needed — Ollama runs fully offline on your machine.
To switch to a cloud provider, set `LLM_BASE_URL`, `LLM_API_KEY`, and `LLM_MODEL` in your `.env`.

## Key takeaway

An LLM is just a function:

```
messages_in → API call → message_out
```

Everything else in this series (structured output, tool use, agents, MCP) is built on top of this one call.

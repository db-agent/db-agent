# Module 01 — LLM Basics

**Concept:** How do you talk to a language model?

This module ships in two flavours — pick whichever is easier for you:

| Notebook | LLM provider | Cost | Setup |
|----------|--------------|------|-------|
| [`notebook_ollama.ipynb`](notebook_ollama.ipynb) | Local Ollama (`llama3.2:1b`) | Free, offline | Install Ollama + 1 GB model pull |
| [`notebook_openai.ipynb`](notebook_openai.ipynb) | [GitHub Models](https://github.com/marketplace/models) (`openai/gpt-4o-mini`) | Free tier | GitHub PAT only |

Both notebooks teach the same content with the same code — only `BASE_URL`, `API_KEY` and `MODEL` differ.

## What you'll learn

- The structure of a chat API call (`model`, `messages`, `temperature`)
- The difference between `system`, `user`, and `assistant` roles
- What the raw API response looks like before you parse it
- How `temperature=0` makes responses deterministic

## Prerequisites

**Common:**
```bash
pip install openai python-dotenv
```

**Option A — Ollama (offline):**
```bash
brew install ollama          # or see https://ollama.com
ollama pull llama3.2:1b      # ~1 GB, one-time download
ollama serve                 # keep running in a separate terminal
```

**Option B — GitHub Models (hosted, free tier):**
1. Create a token at https://github.com/settings/tokens (default permissions are enough).
2. Put it in `.env` at the repo root:
   ```
   GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```

## Key takeaway

An LLM is just a function:

```
messages_in → API call → message_out
```

Everything else in this series (structured output, tool use, agents, MCP) is built on top of this one call.

# Module 01 — LLM Basics

**Concept:** How do you talk to a language model?

Open [`llm_basics.ipynb`](llm_basics.ipynb) in a Databricks workspace (the free tier is enough) and run the cells top-to-bottom.

## What you'll learn

- The structure of a chat API call (`model`, `messages`, `temperature`)
- The difference between `system`, `user`, and `assistant` roles
- What the raw API response looks like before you parse it
- How `temperature=0` makes responses deterministic
- How to keep a multi-turn conversation

## Setup

1. Import `llm_basics.ipynb` into your Databricks workspace.
2. Attach it to any cluster or serverless compute (the free tier works).
3. Run the first cell — it installs `openai` and restarts Python.
4. Run the widgets cell. Three input boxes appear at the top of the notebook:
   - **API_KEY** — paste your [GitHub Models token](https://github.com/settings/tokens) (default scopes are fine).
   - **BASE_URL** — leave as `https://models.github.ai/inference`.
   - **MODEL** — leave as `openai/gpt-4o-mini`, or pick another from the [GitHub Models marketplace](https://github.com/marketplace?type=models).
5. Run the remaining cells in order.

## Switching providers

The same notebook works with any OpenAI-compatible endpoint. Just change the widget values:

| Provider | `BASE_URL` | `MODEL` |
|----------|------------|---------|
| GitHub Models (free) | `https://models.github.ai/inference` | `openai/gpt-4o-mini` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| Databricks Model Serving | `https://<workspace-host>/serving-endpoints` | your serving endpoint name |
| Groq | `https://api.groq.com/openai/v1` | `llama-3.1-8b-instant` |

## Key takeaway

An LLM is just a function:

```
messages_in → API call → message_out
```

Everything else in this series (structured output, tool use, agents, MCP) is built on top of this one call.

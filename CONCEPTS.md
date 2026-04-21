# Concepts Glossary

Plain-English definitions for every term used across the learning modules.

---

## LLM (Large Language Model)

A neural network trained to predict the next token given a sequence of tokens.
For our purposes: a function that takes text in and returns text out.

```
LLM(prompt) → response_text
```

Examples: GPT-4o, Claude 3, Llama 3, Mistral, Gemini.

---

## API / OpenAI-compatible API

A network endpoint you call over HTTP to use an LLM without running it yourself.
OpenAI defined the de-facto standard interface — most providers (Groq, Ollama, LM Studio, Together AI) copy it so one piece of client code works everywhere.

Key request fields:
- `model` — which LLM to use
- `messages` — the conversation so far (list of `{role, content}` objects)
- `temperature` — randomness (0 = deterministic, 1 = creative)

---

## Messages / Chat Format

LLMs are stateless — they don't remember previous conversations.
You simulate memory by sending the whole conversation history on every call.

Three roles:
- `system` — background instructions (persona, rules, output format)
- `user` — what the human typed
- `assistant` — what the LLM previously said
- `tool` — the result of a tool call (see Tool Use)

```python
messages = [
    {"role": "system",    "content": "You are a helpful SQL assistant."},
    {"role": "user",      "content": "How many users signed up last week?"},
    # ← LLM response goes here, then more user messages, etc.
]
```

---

## Structured Output / JSON Mode

By default LLMs return free-form text.
Structured output forces the model to return valid JSON matching a schema you specify.

Why it matters: code can reliably parse JSON; parsing free-form text is brittle.

Two approaches:
1. **Prompt engineering** — ask the model to return JSON in the system prompt
2. **JSON mode / response_format** — instruct the API to guarantee valid JSON output

---

## Pydantic

A Python library that validates data against a schema at runtime.

```python
from pydantic import BaseModel

class SQLResponse(BaseModel):
    sql: str
    explanation: str

# This will raise ValidationError if the dict is missing fields or has wrong types
response = SQLResponse(**{"sql": "SELECT ...", "explanation": "..."})
```

Used in this project to define contracts between pipeline stages (see `streamlit_app/models.py`).

---

## Tool Use / Function Calling

An LLM feature where, instead of generating text, the model returns a structured request
to call a function with specific arguments.

**Without tool use:** LLM says "the answer is 42"
**With tool use:** LLM says "please call `run_query(sql='SELECT count(*) FROM users')` for me"

Your code executes the function, returns the result to the LLM, and it continues.
This gives the LLM agency over *what data to fetch* — not just what to say.

```
User question
    ↓
LLM decides: I need to call get_schema()
    ↓
Your code calls get_schema() → returns table/column names
    ↓
LLM decides: now I'll call run_query(sql="SELECT ...")
    ↓
Your code runs the SQL → returns rows
    ↓
LLM reads rows → writes final answer
```

---

## Agent

A program where an LLM drives a loop: observe → think → act → observe again.

The key property: **the LLM decides what to do next**, not your code.

A fixed pipeline (like `streamlit_app/pipeline.py`) is NOT an agent — the developer hard-coded the steps.
An agent lets the LLM choose which tools to call, in what order, how many times.

---

## Agentic Loop

The fundamental pattern of every AI agent:

```
while not done:
    response = llm(messages, tools)
    if response.finish_reason == "stop":
        return response.content     # LLM is done
    for tool_call in response.tool_calls:
        result = execute(tool_call)
        messages.append(result)     # feed result back
```

Important properties:
- **Max steps** — always set a limit to prevent infinite loops
- **Error recovery** — if a tool returns an error, feed it back to the LLM so it can try again
- **Observability** — log every tool call and result so you can debug

---

## MCP (Model Context Protocol)

A standard protocol (created by Anthropic) for LLMs to communicate with external tools and data sources.

Think of it like HTTP for AI tools:
- **HTTP** lets any browser talk to any web server
- **MCP** lets any LLM client talk to any MCP server

Without MCP: you write custom tool-calling code for every LLM client you use.
With MCP: write the server once, use it from Claude Desktop, Cursor, your own agent, etc.

MCP servers expose three types of capabilities:
- **Tools** — functions the LLM can call (e.g., `run_query`)
- **Resources** — data the LLM can read (e.g., the current database schema)
- **Prompts** — reusable prompt templates

---

## Context Window

The maximum amount of text an LLM can "see" at once — its working memory.
Every message in the conversation, every tool result, every schema dump counts against this limit.

Practical impact: if your database schema is large, it might crowd out the actual question.
Solutions: summarize the schema, only include relevant tables, or use embeddings to retrieve relevant context.

---

## Temperature

Controls how random (creative) vs deterministic the LLM's outputs are.

- `temperature=0` — always picks the highest-probability next token; reproducible
- `temperature=1` — samples from the distribution; creative but inconsistent

For SQL generation we use `temperature=0` — we want the same schema to produce
the same query every time, not creative variations.

---

## System Prompt

The first message in the conversation (role: `system`) that sets the LLM's behavior for the entire session.
Think of it as the instruction manual the LLM reads before you say anything.

Good system prompts:
- Define the persona and goal
- Set output format requirements
- State hard rules (e.g., "only generate SELECT statements")
- Provide context that applies to every turn (e.g., database schema)

---

## Guardrails

Checks that run *around* the LLM to catch dangerous or malformed outputs before they cause harm.

In this project: `sql_safety.py` is a guardrail — it validates the SQL *after* the LLM generates it
and *before* it runs against the database. The LLM can't bypass this check.

Rule of thumb: never trust LLM output without validation at system boundaries.

---

## Prompt Injection

An attack where malicious content in the data the LLM reads tries to override your instructions.

Example: a database row contains `"; DROP TABLE users; --"` and the LLM might try to execute it.
The SQL safety guardrail (keyword blocklist) is one defense against this.

---

## FastMCP

A high-level Python library that makes writing MCP servers easy.
Instead of implementing the MCP protocol by hand, you decorate Python functions:

```python
from mcp.server.fastmcp import FastMCP
mcp = FastMCP("my-server")

@mcp.tool()
def my_tool(input: str) -> str:
    """Description the LLM sees when deciding whether to use this tool."""
    return do_something(input)
```

The library handles all protocol details — your job is just to write the functions.

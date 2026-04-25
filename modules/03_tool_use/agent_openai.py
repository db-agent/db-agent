"""
Module 03 — Tool Use (GitHub Models / OpenAI variant)
=====================================================
Same teaching content as agent_ollama.py — only the LLM endpoint changes.

This version targets GitHub Models (https://github.com/marketplace/models),
a free OpenAI-compatible inference API. Set GITHUB_TOKEN in your env or .env.

Run:
    python modules/03_tool_use/agent_openai.py
    python modules/03_tool_use/agent_openai.py "How many products are in each category?"
"""

import sys
import json
from pathlib import Path

# Add repo root to path so we can reuse the existing db and safety modules
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

import os
from dotenv import load_dotenv
from openai import OpenAI

from streamlit_app.db import get_schema, run_query as db_run_query
from streamlit_app.sql_safety import validate_sql

load_dotenv(Path(__file__).parent.parent.parent / ".env")  # repo root

# ── LLM client (GitHub Models by default) ─────────────────────────────────────
BASE_URL = os.getenv("LLM_BASE_URL", "https://models.github.ai/inference")
API_KEY  = os.getenv("LLM_API_KEY")  or os.getenv("GITHUB_TOKEN")
MODEL    = os.getenv("LLM_MODEL",    "openai/gpt-4o-mini")

if not API_KEY:
    raise SystemExit(
        "Set GITHUB_TOKEN (or LLM_API_KEY) in your environment or .env file. "
        "Create a token at https://github.com/settings/tokens"
    )

client = OpenAI(base_url=BASE_URL, api_key=API_KEY)


# ── Tool definitions ───────────────────────────────────────────────────────────
# This JSON schema is what the LLM sees. It uses the descriptions to decide
# which tool to call and what arguments to pass.

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_schema",
            "description": (
                "Inspect the database — returns every table name and its column "
                "definitions (name + type). Always call this first if you don't "
                "already know the schema."
            ),
            "parameters": {
                "type": "object",
                "properties": {},
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_query",
            "description": (
                "Execute a read-only SELECT query against the database and return "
                "the results as JSON. Only SELECT statements are allowed — any "
                "write operation will be blocked."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "sql": {
                        "type": "string",
                        "description": "A valid SELECT statement using only tables and columns from the schema.",
                    }
                },
                "required": ["sql"],
            },
        },
    },
]

SYSTEM_PROMPT = """\
You are a helpful database assistant. You have two tools available:
  - get_schema: inspect the database to see its tables and columns
  - run_query:  execute a SELECT query and get back rows

Strategy:
1. Always call get_schema first to understand the data before writing SQL.
2. Write and run the minimal query that answers the question.
3. After getting results, summarise them clearly for the user.

Important: only generate SELECT queries. Never attempt write operations.
"""


# ── Tool execution ─────────────────────────────────────────────────────────────

def run_tool(name: str, arguments: dict) -> str:
    """Execute a tool call and return the result as a string for the LLM."""

    if name == "get_schema":
        schema = get_schema()
        return json.dumps(schema, indent=2)

    if name == "run_query":
        sql = arguments["sql"]

        # Safety check before executing — same guardrail as pipeline.py
        validation = validate_sql(sql)
        if not validation.is_safe:
            # Return the error to the LLM so it can correct its query
            return f"ERROR (safety check failed): {validation.reason}"

        try:
            columns, rows = db_run_query(sql)
            return json.dumps(
                {"columns": columns, "rows": rows[:50]},  # cap at 50 rows
                default=str,
            )
        except Exception as exc:
            # Return the DB error to the LLM so it can fix its SQL
            return f"ERROR (query failed): {exc}"

    return f"ERROR: unknown tool '{name}'"


# ── Agent ──────────────────────────────────────────────────────────────────────

def ask(question: str) -> None:
    """
    Run a single question through the tool-calling agent.

    The loop here is the core of every tool-use agent:
      1. Send messages + tools to the LLM
      2. If finish_reason == "tool_calls": execute the tools, append results, go to 1
      3. If finish_reason == "stop": the LLM is done — print its answer
    """
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user",   "content": question},
    ]

    print(f"\nQuestion: {question}")
    print("-" * 60)

    step = 0
    while True:
        step += 1
        response = client.chat.completions.create(
            model=MODEL,
            messages=messages,
            tools=TOOLS,
            temperature=0,
        )

        choice = response.choices[0]
        message = choice.message

        # Always append the assistant message — it may contain tool_calls
        messages.append(message)

        if choice.finish_reason == "stop":
            # LLM is done — it has all the data it needs
            print(f"\nAnswer:\n{message.content}")
            break

        if choice.finish_reason == "tool_calls":
            # LLM wants to call one or more tools
            for tool_call in message.tool_calls:
                fn_name = tool_call.function.name
                fn_args = json.loads(tool_call.function.arguments)

                print(f"[step {step}] → {fn_name}({json.dumps(fn_args) if fn_args else ''})")

                result = run_tool(fn_name, fn_args)

                # Append the tool result — the LLM will see this on the next iteration
                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": result,
                })

                # Print a short preview so you can watch the agent work
                preview = result[:120].replace("\n", " ")
                print(f"         ← {preview}{'...' if len(result) > 120 else ''}")
        else:
            # Unexpected finish reason — bail out
            print(f"Unexpected finish_reason: {choice.finish_reason}")
            break

    print("-" * 60)
    print(f"Total steps: {step}  |  Total messages: {len(messages)}")


# ── Entry point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    default_question = "What are the top 5 most expensive products?"
    question = " ".join(sys.argv[1:]) if len(sys.argv) > 1 else default_question
    ask(question)

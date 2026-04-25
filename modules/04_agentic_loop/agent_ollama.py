"""
Module 04 — Agentic Loop (Ollama variant)
=========================================
Teaching goal: show how an agent retries on errors, limits its steps,
and maintains conversation history across multiple questions.

New concepts vs Module 03:
  - MAX_STEPS guard prevents infinite loops
  - Errors are returned to the LLM so it can fix its own SQL
  - REPL mode shows conversation memory across multiple questions
  - ReAct-style system prompt (Reason + Act) improves reliability

Run:
    python modules/04_agentic_loop/agent_ollama.py
    python modules/04_agentic_loop/agent_ollama.py "Which customers have never ordered?"
    python modules/04_agentic_loop/agent_ollama.py --repl

Prefer a hosted, free LLM? See agent_openai.py (GitHub Models).
"""

import sys
import json
import argparse
from pathlib import Path
from dataclasses import dataclass, field

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

import os
from dotenv import load_dotenv
from openai import OpenAI

from streamlit_app.db import get_schema, run_query as db_run_query
from streamlit_app.sql_safety import validate_sql

load_dotenv(Path(__file__).parent.parent.parent / ".env")

# Defaults to local Ollama — override via .env to point at any OpenAI-compatible endpoint.
BASE_URL = os.getenv("LLM_BASE_URL", "http://localhost:11434/v1")
API_KEY  = os.getenv("LLM_API_KEY",  "ollama")   # Ollama ignores this; required by the client
MODEL    = os.getenv("LLM_MODEL",    "llama3.2:1b")

client = OpenAI(base_url=BASE_URL, api_key=API_KEY)

MAX_STEPS = 8   # safety limit — exceeding this means the agent is stuck


# ── Tool definitions (same as Module 03) ──────────────────────────────────────

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_schema",
            "description": "Inspect the database — returns all table names and column definitions.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_query",
            "description": (
                "Execute a read-only SELECT query. Returns rows as JSON. "
                "If the query fails or is blocked by the safety check, the error "
                "message is returned so you can fix the SQL and try again."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "sql": {"type": "string", "description": "A valid SELECT statement."}
                },
                "required": ["sql"],
            },
        },
    },
]

# ReAct-style system prompt: ask the model to reason before acting.
# This makes the chain of thought explicit and improves accuracy.
SYSTEM_PROMPT = """\
You are a database analyst assistant. You answer questions by querying a SQL database.

You have two tools:
  - get_schema: see the database tables and columns
  - run_query:  run a SELECT query

Work through problems step by step:
  1. Think about what data you need (reason before acting)
  2. Call get_schema if you don't know the schema yet
  3. Write and run the SQL query
  4. If the query returns an error, read the error message and fix the SQL
  5. When you have enough data, summarise the answer clearly

Rules:
  - Only use SELECT statements — write operations are blocked
  - If a query fails, try once more with corrected SQL before giving up
  - Be concise in your final answer; lead with the key number or fact
"""


# ── Agent state ────────────────────────────────────────────────────────────────

@dataclass
class AgentResult:
    answer: str
    steps_taken: int
    tool_calls_made: list[dict] = field(default_factory=list)
    hit_step_limit: bool = False


# ── Tool execution ─────────────────────────────────────────────────────────────

def run_tool(name: str, arguments: dict) -> str:
    """Execute a tool and always return a string (never raise)."""

    if name == "get_schema":
        schema = get_schema()
        return json.dumps(schema, indent=2)

    if name == "run_query":
        sql = arguments.get("sql", "")

        validation = validate_sql(sql)
        if not validation.is_safe:
            # Key teaching moment: we RETURN the error, not raise it.
            # This feeds the error back into the conversation so the LLM
            # can read it and generate a corrected query on the next step.
            return f"SAFETY_ERROR: {validation.reason}\nPlease fix the SQL and try again."

        try:
            columns, rows = db_run_query(sql)
            return json.dumps({"columns": columns, "rows": rows[:50]}, default=str)
        except Exception as exc:
            # Same pattern: return DB errors to the LLM for self-correction
            return f"DB_ERROR: {exc}\nPlease fix the SQL and try again."

    return f"UNKNOWN_TOOL: '{name}'"


# ── Core agent loop ────────────────────────────────────────────────────────────

def run_agent(question: str, history: list[dict], verbose: bool = True) -> AgentResult:
    """
    Run the agentic loop for one question.

    `history` is the ongoing conversation — pass the same list across multiple
    questions to give the agent memory of previous turns (REPL mode).

    The loop:
        while steps < MAX_STEPS:
            1. Call LLM with current messages + tools
            2. If finish_reason == "stop"  → done, extract answer
            3. If finish_reason == "tool_calls" → execute tools, append results, continue
            4. If steps == MAX_STEPS → give up, return partial answer
    """
    # Append the new user question to the shared history
    history.append({"role": "user", "content": question})

    tool_calls_log = []

    for step in range(1, MAX_STEPS + 1):
        response = client.chat.completions.create(
            model=MODEL,
            messages=history,
            tools=TOOLS,
            temperature=0,
        )

        choice = response.choices[0]
        message = choice.message
        history.append(message)  # always record what the assistant said

        if verbose:
            print(f"  [step {step}] finish_reason={choice.finish_reason}", end="")

        if choice.finish_reason == "stop":
            if verbose:
                print()  # newline after the step line
            return AgentResult(
                answer=message.content or "",
                steps_taken=step,
                tool_calls_made=tool_calls_log,
            )

        if choice.finish_reason == "tool_calls":
            if verbose:
                print()
            for tool_call in message.tool_calls:
                fn_name = tool_call.function.name
                fn_args = json.loads(tool_call.function.arguments)

                if verbose:
                    print(f"           → {fn_name}({json.dumps(fn_args) if fn_args else ''})")

                result = run_tool(fn_name, fn_args)
                tool_calls_log.append({"tool": fn_name, "args": fn_args, "result_preview": result[:80]})

                history.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": result,
                })

                if verbose:
                    preview = result[:100].replace("\n", " ")
                    print(f"           ← {preview}{'...' if len(result) > 100 else ''}")
        else:
            if verbose:
                print(f" (unexpected — stopping)")
            break

    # Reached MAX_STEPS without a "stop" — the agent is stuck
    return AgentResult(
        answer="Agent reached the maximum number of steps without completing.",
        steps_taken=MAX_STEPS,
        tool_calls_made=tool_calls_log,
        hit_step_limit=True,
    )


# ── Single-question mode ───────────────────────────────────────────────────────

def run_once(question: str) -> None:
    history = [{"role": "system", "content": SYSTEM_PROMPT}]

    print(f"\nQuestion: {question}")
    print("=" * 60)

    result = run_agent(question, history, verbose=True)

    print("\nAnswer:")
    print(result.answer)
    print("=" * 60)
    print(f"Steps: {result.steps_taken}/{MAX_STEPS}  |  "
          f"Tool calls: {len(result.tool_calls_made)}  |  "
          f"Messages in history: {len(history)}")
    if result.hit_step_limit:
        print("⚠️  Agent hit the step limit — question may be too complex or LLM is confused.")


# ── REPL mode — multiple questions with shared history ─────────────────────────

def run_repl() -> None:
    """
    Interactive mode: ask follow-up questions and the agent remembers context.

    Key teaching moment: 'messages' grows with every turn.
    The agent can answer "show me the same for last month" because it
    has seen the previous SQL and results.
    """
    history = [{"role": "system", "content": SYSTEM_PROMPT}]

    print("\nDB Agent — Interactive Mode")
    print("Ask questions about the database. Type 'quit' to exit.")
    print("The agent remembers your previous questions and its own answers.\n")

    while True:
        try:
            question = input("You: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nGoodbye!")
            break

        if not question:
            continue
        if question.lower() in {"quit", "exit", "q"}:
            print("Goodbye!")
            break

        print()
        result = run_agent(question, history, verbose=True)
        print(f"\nAgent: {result.answer}")
        print(f"\n[steps: {result.steps_taken} | history length: {len(history)} messages]\n")


# ── Entry point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Agentic loop demo")
    parser.add_argument("question", nargs="*", help="Question to ask")
    parser.add_argument("--repl", action="store_true", help="Start interactive REPL")
    args = parser.parse_args()

    if args.repl:
        run_repl()
    else:
        q = " ".join(args.question) if args.question else "What are the top 3 best-selling products?"
        run_once(q)

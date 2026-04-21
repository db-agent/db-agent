# Learning Modules

Work through these modules in order. Each one builds on the last.

---

```
modules/
├── 01_llm_basics/          ← What is an LLM API call?
├── 02_structured_output/   ← How do we get reliable JSON from an LLM?
├── 03_tool_use/            ← How does the LLM call tools / functions?
├── 04_agentic_loop/        ← How does an agent retry, reflect, and recover?
└── 05_mcp_server/          ← What is MCP? Build a server in 50 lines.
```

---

## Prerequisites

```bash
# From the repo root
pip install -r requirements.txt
cp .env.example .env   # then add your LLM_API_KEY
```

Modules 01–02 are Jupyter notebooks — open them with:
```bash
jupyter notebook
# or
jupyter lab
```

Modules 03–05 are standalone Python scripts — run them directly:
```bash
python modules/03_tool_use/agent.py
```

---

## The big picture

The existing `streamlit_app/` is the **finished product** — a complete text-to-SQL pipeline.
These modules show you how to build it from scratch, concept by concept:

| Module | Concept | Key question answered |
|--------|---------|----------------------|
| 01 | LLM API call | How do I talk to a language model? |
| 02 | Structured output | How do I get back JSON I can actually use? |
| 03 | Tool use | How does the LLM decide *what to do* instead of *what to say*? |
| 04 | Agentic loop | How does an agent try again when something goes wrong? |
| 05 | MCP server | How do I expose my tools to *any* LLM client, not just my own code? |

See [CONCEPTS.md](../CONCEPTS.md) for a plain-English glossary of every term used across modules.

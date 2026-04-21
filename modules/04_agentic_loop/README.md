# Module 04 — Agentic Loop

**Concept:** How does an agent recover from errors, reflect on its work, and know when to stop?

## What's new vs Module 03

Module 03 showed the tool-calling loop. Module 04 adds:

| Feature | Module 03 | Module 04 |
|---------|-----------|-----------|
| Tool calling | ✓ | ✓ |
| Error recovery (retry on bad SQL) | Partial | ✓ Full |
| Max steps guard | ✗ | ✓ |
| Step-by-step reasoning log | Basic | Verbose |
| Multi-question / follow-up | ✗ | ✓ |
| ReAct pattern (Reason + Act) | ✗ | ✓ |

## Run it

```bash
# Single question
python modules/04_agentic_loop/agent.py "Which customers have placed more than 3 orders?"

# Interactive REPL — ask multiple follow-up questions
python modules/04_agentic_loop/agent.py --repl
```

## Key teaching moments

1. **Error recovery** — Intentionally ask a question that produces bad SQL on the first try.
   Watch the agent catch the error, feed it back to the LLM, and get a corrected query.

2. **Max steps** — Without a limit, a confused agent can loop forever.
   `MAX_STEPS = 8` is the guardrail. Exceeding it means something is wrong.

3. **REPL mode** — Shows how conversation history accumulates across questions.
   The agent can answer "show me the same for last month" because it remembers context.

4. **ReAct** — The agent is prompted to think before acting ("Thought: ..., Action: ...").
   This improves reliability, especially for complex multi-step questions.

#!/usr/bin/env bash
# run_local.sh — fire up DB Agent against local SQLite + local Ollama.
#
# Does not touch .env — exports overrides for this process only, so your
# cloud config (Lakebase / GitHub Models) stays untouched on disk.
#
#   ./run_local.sh
#   ./run_local.sh llama3.2       # use a different local model

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

MODEL="${1:-qwen2.5-coder:7b}"

if ! command -v ollama >/dev/null 2>&1; then
    echo "ollama not found on PATH — install it from https://ollama.com" >&2
    exit 1
fi

if ! ollama list | tail -n +2 | awk '{print $1}' | grep -qx "$MODEL"; then
    echo "Model '$MODEL' not pulled locally. Run: ollama pull $MODEL" >&2
    exit 1
fi

if ! curl -s -o /dev/null http://localhost:11434/v1/models; then
    echo "Ollama server not reachable at localhost:11434 — start it with: ollama serve" >&2
    exit 1
fi

export DB_URL="sqlite:///./data/demo.db"
export LLM_BASE_URL="http://localhost:11434/v1"
export LLM_API_KEY="ollama"
export LLM_MODEL="$MODEL"

echo "DB_URL=$DB_URL"
echo "LLM_BASE_URL=$LLM_BASE_URL"
echo "LLM_MODEL=$LLM_MODEL"

exec streamlit run app.py

#!/usr/bin/env bash
# run_local.sh — fire up DB Agent (Node) against local SQLite + local Ollama.
# Mirrors ../run_local.sh's checks/behavior for the Streamlit app.
#
# Does not touch .env — exports overrides for this process only.
#
#   ./run_local.sh
#   ./run_local.sh llama3.2       # use a different local model

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

MODEL="${1:-qwen2.5-coder:7b}"
EMBED_MODEL="${EMBEDDING_MODEL:-nomic-embed-text}"

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

if ! ollama list | tail -n +2 | awk '{print $1}' | grep -qx "$EMBED_MODEL"; then
    echo "Embedding model '$EMBED_MODEL' not pulled — cross-agent memory will be" >&2
    echo "silently skipped until you run: ollama pull $EMBED_MODEL" >&2
fi

export DB_PATH="../data/demo.db"
export LLM_BASE_URL="http://localhost:11434/v1"
export LLM_API_KEY="ollama"
export LLM_MODEL="$MODEL"
export EMBEDDING_MODEL="$EMBED_MODEL"
export DBAGENT_ID="${DBAGENT_ID:-local}"

echo "DB_PATH=$DB_PATH"
echo "LLM_BASE_URL=$LLM_BASE_URL"
echo "LLM_MODEL=$LLM_MODEL"
echo "EMBEDDING_MODEL=$EMBEDDING_MODEL"
echo "DBAGENT_ID=$DBAGENT_ID"

if [ ! -d node_modules ]; then
    echo "Installing server dependencies…"
    npm install
fi

if [ ! -d web/dist ]; then
    echo "Frontend not built yet — building (web/dist missing)…"
    npm run build
fi

exec npm start

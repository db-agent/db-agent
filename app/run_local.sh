#!/usr/bin/env bash
# run_local.sh — fire up DB Agent (Node) against local SQLite + local Ollama
# by default. Respects any LLM_BASE_URL / EMBEDDING_BASE_URL / etc. already
# exported by the caller — chat and embeddings are independent endpoints
# (see server.js), so e.g. chat can stay on local Ollama while embeddings
# route to Databricks AI Gateway, which is what cross-platform memory needs:
# every agent sharing a vector store must use the same embedding model, but
# each agent's own chat/SQL-generation model can be anything.
#
#   ./run_local.sh
#   ./run_local.sh llama3.2       # use a different local Ollama chat model
#
#   Chat on Ollama, embeddings on Databricks (for testing S3 Vectors memory
#   against a Databricks-hosted agent):
#     EMBEDDING_BASE_URL=https://.../ai-gateway/mlflow/v1 EMBEDDING_API_KEY=$TOKEN \
#       EMBEDDING_MODEL=system.ai.qwen3-embedding-0-6b ./run_local.sh
#
#   Both chat and embeddings on a remote endpoint (skips Ollama entirely):
#     LLM_BASE_URL=https://.../ai-gateway/mlflow/v1 LLM_API_KEY=$TOKEN \
#       LLM_MODEL=main.default.lama-3 EMBEDDING_MODEL=system.ai.qwen3-embedding-0-6b \
#       ./run_local.sh

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

if [ -z "${LLM_BASE_URL:-}" ]; then
    # No LLM_BASE_URL set — default chat to local Ollama, with preflight checks.
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

    export LLM_BASE_URL="http://localhost:11434/v1"
    export LLM_API_KEY="${LLM_API_KEY:-ollama}"
    export LLM_MODEL="$MODEL"
else
    # LLM_BASE_URL already set by the caller — use it as-is.
    export LLM_MODEL="${LLM_MODEL:-gpt-4o-mini}"
fi

if [ -z "${EMBEDDING_BASE_URL:-}" ] && [ "$LLM_BASE_URL" = "http://localhost:11434/v1" ]; then
    # No EMBEDDING_BASE_URL set, and chat is on Ollama — embeddings will fall
    # back to that same Ollama endpoint too (server.js's default), so check
    # the embedding model is actually pulled there.
    EMBED_MODEL="${EMBEDDING_MODEL:-nomic-embed-text}"
    if ! ollama list | tail -n +2 | awk '{print $1}' | grep -qx "$EMBED_MODEL"; then
        echo "Embedding model '$EMBED_MODEL' not pulled — cross-agent memory will be" >&2
        echo "silently skipped until you run: ollama pull $EMBED_MODEL" >&2
    fi
    export EMBEDDING_MODEL="$EMBED_MODEL"
else
    # Either EMBEDDING_BASE_URL is set explicitly (embeddings go elsewhere,
    # e.g. Databricks, independent of the Ollama chat model above), or chat
    # itself isn't on Ollama — no Ollama embedding check applies either way.
    export EMBEDDING_MODEL="${EMBEDDING_MODEL:-text-embedding-3-small}"
fi

export DBAGENT_ID="${DBAGENT_ID:-local}"
# DB_PATH is intentionally not set here — server.js defaults to the
# self-contained ./data/demo.db bundled in this directory. Export DB_PATH
# yourself before calling this script to point elsewhere.

echo "LLM_BASE_URL=$LLM_BASE_URL"
echo "LLM_MODEL=$LLM_MODEL"
echo "EMBEDDING_BASE_URL=${EMBEDDING_BASE_URL:-(default: same as LLM_BASE_URL)}"
echo "EMBEDDING_MODEL=$EMBEDDING_MODEL"
echo "DBAGENT_ID=$DBAGENT_ID"
echo "DB_PATH=${DB_PATH:-(default: ./data/demo.db)}"

if [ ! -d node_modules ]; then
    echo "Installing server dependencies…"
    npm install
fi

if [ ! -d web/dist ]; then
    echo "Frontend not built yet — building (web/dist missing)…"
    npm run build
fi

exec npm start

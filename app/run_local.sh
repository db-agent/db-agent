#!/usr/bin/env bash
# run_local.sh — fire up DB Agent (Node) against Databricks SQL (from .env)
# + local Ollama by default. Respects any LLM_BASE_URL / EMBEDDING_BASE_URL /
# etc. already exported by the caller.
#
#   cp .env.example .env   # set DATABRICKS_* then:
#   ./run_local.sh
#   ./run_local.sh qwen2.5-coder:0.5b
#
#   Both chat and embeddings on a remote endpoint (skips Ollama entirely):
#     LLM_BASE_URL=https://.../ai-gateway/mlflow/v1 LLM_API_KEY=$TOKEN \
#       LLM_MODEL=main.default.lama-3 ./run_local.sh

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

if [ -z "${LLM_BASE_URL:-}" ]; then
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
    export LLM_MODEL="${LLM_MODEL:-gpt-4o-mini}"
fi

if [ -z "${EMBEDDING_BASE_URL:-}" ] && [ "$LLM_BASE_URL" = "http://localhost:11434/v1" ]; then
    EMBED_MODEL="${EMBEDDING_MODEL:-nomic-embed-text}"
    if ! ollama list | tail -n +2 | awk '{print $1}' | grep -qx "$EMBED_MODEL"; then
        echo "Embedding model '$EMBED_MODEL' not pulled — cross-agent memory will be" >&2
        echo "silently skipped until you run: ollama pull $EMBED_MODEL" >&2
    fi
    export EMBEDDING_MODEL="$EMBED_MODEL"
else
    export EMBEDDING_MODEL="${EMBEDDING_MODEL:-text-embedding-3-small}"
fi

export DBAGENT_ID="${DBAGENT_ID:-local}"
export SQL_ENGINE="${SQL_ENGINE:-databricks-sql}"

missing=()
for key in DATABRICKS_HOST DATABRICKS_HTTP_PATH DATABRICKS_TOKEN DATABRICKS_CATALOG DATABRICKS_SCHEMA; do
  if [ -z "${!key:-}" ]; then
    missing+=("$key")
  fi
done
if [ "$SQL_ENGINE" = "databricks-sql" ] && [ "${#missing[@]}" -gt 0 ]; then
  echo "SQL_ENGINE=databricks-sql requires: ${missing[*]}" >&2
  echo "Copy .env.example to .env and fill in your warehouse details." >&2
  exit 1
fi

echo "LLM_BASE_URL=$LLM_BASE_URL"
echo "LLM_MODEL=$LLM_MODEL"
echo "EMBEDDING_BASE_URL=${EMBEDDING_BASE_URL:-(default: same as LLM_BASE_URL)}"
echo "EMBEDDING_MODEL=$EMBEDDING_MODEL"
echo "DBAGENT_ID=$DBAGENT_ID"
echo "SQL_ENGINE=$SQL_ENGINE"
if [ "$SQL_ENGINE" = "databricks-sql" ]; then
  echo "DATABRICKS_HOST=$DATABRICKS_HOST"
  echo "DATABRICKS_CATALOG=$DATABRICKS_CATALOG.$DATABRICKS_SCHEMA"
fi

if [ ! -d node_modules ]; then
    echo "Installing server dependencies…"
    npm install
fi

if [ ! -d web/dist ]; then
    echo "Frontend not built yet — building (web/dist missing)…"
    npm run build
fi

exec npm start

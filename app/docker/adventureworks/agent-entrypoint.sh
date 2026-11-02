#!/bin/sh
# Starts one db-agent for the AdventureWorks demo.
#   CURATED=true  builds the curated ontology (database comments plus the hand-written file) before starting.
#   otherwise     starts with no knowledge file, so "Scan database" has something to show.
# Both load the 17 benchmark questions so the Accuracy test works. Everything lives in the container: recreate it to reset.
set -eu
PORT="${PORT:-3001}"
if [ "${CURATED:-false}" = "true" ]; then
  node scripts/adventureworks/ontology-from-comments.js /tmp/comments.json
  node scripts/adventureworks/build-curated.js /tmp/comments.json "$KNOWLEDGE_FILE"
fi
node server.js &
pid=$!
trap 'kill "$pid" 2>/dev/null' TERM INT
i=0
until node -e "fetch('http://127.0.0.1:$PORT/api/config').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; do
  i=$((i + 1)); [ "$i" -gt 60 ] && echo "server did not start" >&2 && exit 1; sleep 1
done
node scripts/adventureworks/import-cases.js "http://127.0.0.1:$PORT" || echo "could not import the benchmark questions" >&2
wait "$pid"

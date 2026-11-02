#!/bin/sh
# Starts one db-agent for the bakehouse demo.
#   CURATED=true  starts with the prepared ontology (scripts/bakehouse/curated-knowledge.json).
#   otherwise     starts with no knowledge file, so "Scan database" has something to show.
# Both load the bakehouse benchmark questions so the Accuracy test works. State lives in the container: recreate it to reset.
set -eu
PORT="${PORT:-3001}"
# The repo's own seed benchmark questions are for the bundled SQLite demo: leave them out so the Accuracy test counts only these.
echo '[]' > /tmp/no-seed-benchmarks.json
export BENCHMARKS_FILE=/tmp/no-seed-benchmarks.json
if [ "${CURATED:-false}" = "true" ]; then
  cp scripts/bakehouse/curated-knowledge.json "$KNOWLEDGE_FILE"
fi
node server.js &
pid=$!
trap 'kill "$pid" 2>/dev/null' TERM INT
i=0
until node -e "fetch('http://127.0.0.1:$PORT/api/config').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; do
  i=$((i + 1)); [ "$i" -gt 60 ] && echo "server did not start" >&2 && exit 1; sleep 1
done
node scripts/import-benchmark-cases.js scripts/bakehouse/cases.json "http://127.0.0.1:$PORT" || echo "could not import the benchmark questions" >&2
wait "$pid"

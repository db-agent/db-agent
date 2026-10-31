#!/usr/bin/env bash
# Loads AdventureWorks 2014 OLTP (Postgres port) into a throwaway Postgres container on port 5457.
#   scripts/adventureworks/load.sh [dir-for-the-clone]
# Then: DB_URL=postgresql://postgres:pw@localhost:5457/adventureworks PG_SSL=false
set -euo pipefail
DIR="${1:-$(mktemp -d)}"
[ -d "$DIR/src" ] || git clone -q --depth 1 https://github.com/NorfolkDataSci/adventure-works-postgres.git "$DIR/src"
docker rm -f dbagent-aw >/dev/null 2>&1 || true
docker run -d --name dbagent-aw -e POSTGRES_PASSWORD=pw -p 5457:5432 -v "$DIR/src:/aw:ro" postgres:16 >/dev/null
until docker exec dbagent-aw pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
docker exec dbagent-aw psql -U postgres -qc 'CREATE DATABASE adventureworks'
# install.sql reads some CSVs from ./data and some from ./, so link them next to the script
docker exec dbagent-aw bash -c 'cp -r /aw /work && cd /work && for f in data/*.csv; do ln -sf $f .; done'
docker exec -w /work dbagent-aw psql -U postgres -d adventureworks -q -f install.sql >"$DIR/load.log" 2>&1
docker exec dbagent-aw psql -U postgres -d adventureworks -Atc "select 'orders', count(*) from sales.salesorderheader"

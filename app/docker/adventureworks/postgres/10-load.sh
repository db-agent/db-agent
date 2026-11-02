#!/usr/bin/env bash
# Runs once, when the data volume is first created: loads AdventureWorks (about a minute) and creates a read-only role.
set -euo pipefail
psql -v ON_ERROR_STOP=1 -U postgres -c 'CREATE DATABASE adventureworks'
# install.sql reads some CSVs from ./data and some from ./, so work in a copy with both.
W="$(mktemp -d)" && cp -r /aw/. "$W" && cd "$W" && for f in data/*.csv; do ln -sf "$f" .; done
psql -v ON_ERROR_STOP=1 -U postgres -d adventureworks -q -f install.sql
cd / && rm -rf "$W"
psql -v ON_ERROR_STOP=1 -U postgres -d adventureworks <<'SQL'
CREATE ROLE dbagent_ro LOGIN PASSWORD 'dbagent_ro';
GRANT CONNECT ON DATABASE adventureworks TO dbagent_ro;
GRANT USAGE ON SCHEMA humanresources, person, production, purchasing, sales TO dbagent_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA humanresources, person, production, purchasing, sales TO dbagent_ro;
SQL
echo "AdventureWorks loaded."

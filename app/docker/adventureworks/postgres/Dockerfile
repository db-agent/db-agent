# Postgres 16 with the AdventureWorks 2014 OLTP data baked in (Postgres port by Lorin Thwaits, converted CSVs
# from NorfolkDataSci/adventure-works-postgres, MIT). The data is fetched at build time, loaded on first start.
FROM postgres:16
ARG AW_COMMIT=afcfd2dfcf031af91f03f536c1ade349cfcb3ad6
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
 && git init -q /aw && cd /aw \
 && git fetch -q --depth 1 https://github.com/NorfolkDataSci/adventure-works-postgres.git $AW_COMMIT \
 && git checkout -q FETCH_HEAD && rm -rf .git \
 && apt-get purge -y git && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
COPY 10-load.sh /docker-entrypoint-initdb.d/10-load.sh

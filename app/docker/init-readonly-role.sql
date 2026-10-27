-- Runs once, when the compose Postgres volume is first created.
-- The app connects as this role, which can only SELECT: the same least-privilege setup
-- app.yaml / README recommend for Lakebase. The seed job runs as the postgres superuser.
CREATE ROLE dbagent_ro LOGIN PASSWORD 'dbagent_ro';
GRANT CONNECT ON DATABASE olist TO dbagent_ro;
GRANT USAGE ON SCHEMA public TO dbagent_ro;
-- Tables the seed job creates later (as postgres) become readable automatically.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON TABLES TO dbagent_ro;

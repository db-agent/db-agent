"""
load_crude_oil.py — Load Crude Oil historical data into PostgreSQL.

Accepts connection via either:
  DB_URL  — postgresql+psycopg://user:pass@host:port/db  (Terraform track)
  PG_HOST / PG_PORT / PG_USER / PG_PASS / PG_DB          (existing-DB track)

Run from the project root:
    python data/load_crude_oil.py
"""

import csv
import os
import sys
from pathlib import Path

import psycopg

CSV_PATH = Path(__file__).parent / "Crude_Oil_historical_data.csv"

CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS crude_oil_prices (
    date   TIMESTAMPTZ PRIMARY KEY,
    open   NUMERIC,
    high   NUMERIC,
    low    NUMERIC,
    close  NUMERIC,
    volume BIGINT,
    ticker TEXT,
    name   TEXT
)
"""

INSERT_ROW = """
INSERT INTO crude_oil_prices (date, open, high, low, close, volume, ticker, name)
VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
ON CONFLICT (date) DO NOTHING
"""


def build_conninfo() -> str:
    db_url = os.environ.get("DB_URL", "")
    if db_url:
        # Strip SQLAlchemy dialect — psycopg only takes the standard scheme
        db_url = db_url.replace("postgresql+psycopg://", "postgresql://")
        return db_url

    host = os.environ.get("PG_HOST")
    port = os.environ.get("PG_PORT", "5432")
    user = os.environ.get("PG_USER")
    password = os.environ.get("PG_PASS")
    dbname = os.environ.get("PG_DB", "db_agent")

    if not all([host, user, password]):
        sys.exit(
            "ERROR: set either DB_URL or PG_HOST / PG_USER / PG_PASS env vars"
        )

    return f"postgresql://{user}:{password}@{host}:{port}/{dbname}"


def load():
    conninfo = build_conninfo()

    with psycopg.connect(conninfo) as conn:
        with conn.cursor() as cur:
            cur.execute(CREATE_TABLE)

            with open(CSV_PATH, newline="") as f:
                rows = [
                    (
                        row["Date"],
                        row["Open"],
                        row["High"],
                        row["Low"],
                        row["Close"],
                        row["Volume"],
                        row["ticker"],
                        row["name"],
                    )
                    for row in csv.DictReader(f)
                ]

            cur.executemany(INSERT_ROW, rows)
            inserted = cur.rowcount
            conn.commit()

    print(f"crude_oil_prices: {inserted} new rows inserted ({len(rows) - inserted} already existed)")


if __name__ == "__main__":
    load()

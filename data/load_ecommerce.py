"""
load_ecommerce.py — Load Kaggle ecommerce CSVs into PostgreSQL.

Usage:
    # From the repo root:
    DATABASE_URL="postgresql://dbagent:pass@host:5432/db_agent" \\
        python data/load_ecommerce.py --data-dir /path/to/Ecommerce_data

    # Or pass the URL directly:
    python data/load_ecommerce.py \\
        --data-dir /path/to/Ecommerce_data \\
        --db-url "postgresql://dbagent:pass@host:5432/db_agent"

Tables created:
    amazon_orders       — Amazon India order-level sales (~128k rows)
    international_orders — B2B international sales (~37k rows)
    inventory           — SKU-level stock snapshot (~9k rows)
    product_catalog     — Multi-channel pricing per SKU (~1.3k rows)
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

import pandas as pd
from sqlalchemy import create_engine, text

# ── Helpers ───────────────────────────────────────────────────────────────────

def _clean_col(name: str) -> str:
    """Normalise a CSV header to a valid snake_case SQL identifier."""
    name = str(name).strip()
    name = re.sub(r"[^0-9a-zA-Z]+", "_", name)
    name = name.strip("_").lower()
    # Avoid leading digit
    if name and name[0].isdigit():
        name = "col_" + name
    return name or "col"


def _load(path: Path, **read_kwargs) -> pd.DataFrame:
    df = pd.read_csv(path, **read_kwargs)
    # Drop the auto-saved pandas index column that appears in these files
    if "index" in df.columns:
        df = df.drop(columns=["index"])
    # Drop fully-empty columns
    df = df.dropna(axis=1, how="all")
    df.columns = [_clean_col(c) for c in df.columns]
    return df


def _push(df: pd.DataFrame, table: str, engine, rows_already: int = 0) -> int:
    df.to_sql(table, engine, if_exists="replace", index=False, chunksize=1000)
    n = len(df)
    print(f"  ✓  {table:<25} {n:>7,} rows")
    return n


# ── Per-file loaders ──────────────────────────────────────────────────────────

def load_amazon_orders(data_dir: Path, engine) -> None:
    df = _load(data_dir / "Amazon Sale Report.csv")

    # Parse date ("04-30-22" → datetime)
    if "date" in df.columns:
        df["date"] = pd.to_datetime(df["date"], format="%m-%d-%y", errors="coerce")

    # Coerce numeric columns
    for col in ("qty", "amount"):
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    # Drop junk / PII-adjacent columns that add no analytical value
    drop = [c for c in df.columns if c.startswith("unnamed")]
    df = df.drop(columns=drop, errors="ignore")

    _push(df, "amazon_orders", engine)


def load_international_orders(data_dir: Path, engine) -> None:
    df = _load(data_dir / "International sale Report.csv")

    if "date" in df.columns:
        df["date"] = pd.to_datetime(df["date"], format="%m-%d-%y", errors="coerce")

    for col in ("pcs", "rate", "gross_amt"):
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    _push(df, "international_orders", engine)


def load_inventory(data_dir: Path, engine) -> None:
    df = _load(data_dir / "Sale Report.csv")

    if "stock" in df.columns:
        df["stock"] = pd.to_numeric(df["stock"], errors="coerce")

    _push(df, "inventory", engine)


def load_product_catalog(data_dir: Path, engine) -> None:
    frames = []
    for fname in ("May-2022.csv", "P  L March 2021.csv"):
        path = data_dir / fname
        if path.exists():
            df = _load(path)
            # Tag which price list each row came from
            df["source_file"] = fname
            frames.append(df)

    if not frames:
        print("  ⚠  No product catalog files found — skipping")
        return

    # Align columns: outer join fills missing columns with NaN across snapshots
    combined = pd.concat(frames, ignore_index=True, sort=False)

    # Coerce all MRP / price columns to numeric
    price_pat = re.compile(r"(mrp|tp|weight)", re.IGNORECASE)
    for col in combined.columns:
        if price_pat.search(col):
            combined[col] = pd.to_numeric(combined[col], errors="coerce")

    _push(combined, "product_catalog", engine)


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Load ecommerce CSVs into PostgreSQL")
    parser.add_argument(
        "--data-dir",
        required=True,
        help="Directory containing the Kaggle ecommerce CSV files",
    )
    parser.add_argument(
        "--db-url",
        default=os.environ.get("DATABASE_URL") or os.environ.get("DB_URL"),
        help="SQLAlchemy connection string (or set DATABASE_URL env var)",
    )
    args = parser.parse_args()

    if not args.db_url:
        sys.exit(
            "Error: provide --db-url or set the DATABASE_URL environment variable."
        )

    data_dir = Path(args.data_dir).expanduser().resolve()
    if not data_dir.is_dir():
        sys.exit(f"Error: data directory not found: {data_dir}")

    engine = create_engine(args.db_url)

    # Verify connection before doing any work
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception as exc:
        sys.exit(f"Error: cannot connect to database — {exc}")

    print(f"\nLoading ecommerce data from {data_dir}\n")

    load_amazon_orders(data_dir, engine)
    load_international_orders(data_dir, engine)
    load_inventory(data_dir, engine)
    load_product_catalog(data_dir, engine)

    print("\nDone.")


if __name__ == "__main__":
    main()

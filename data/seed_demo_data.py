"""
seed_demo_data.py — Populate the demo database.

Run from the project root:
    python data/seed_demo_data.py

Reads DB_URL from .env (or environment). Falls back to a local SQLite file.

Creates three tables:
    customers   — who bought things
    products    — what they bought
    orders      — the transactions linking customers ↔ products
"""

import os
import sqlite3
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

DB_URL = os.environ.get("DB_URL") or os.environ.get("DATABASE_URL")
DB_PATH = Path(__file__).parent / "demo.db"

_USE_POSTGRES = DB_URL and not DB_URL.startswith("sqlite")


def _get_connection():
    if _USE_POSTGRES:
        from sqlalchemy import create_engine, text
        engine = create_engine(DB_URL)
        return engine.connect(), "postgres"
    os.makedirs(DB_PATH.parent, exist_ok=True)
    return sqlite3.connect(DB_PATH), "sqlite"


def seed():
    conn, mode = _get_connection()

    if mode == "postgres":
        from sqlalchemy import text
        conn.execute(text("DROP TABLE IF EXISTS orders CASCADE"))
        conn.execute(text("DROP TABLE IF EXISTS customers CASCADE"))
        conn.execute(text("DROP TABLE IF EXISTS products CASCADE"))
        conn.execute(text("""
            CREATE TABLE customers (
                id        SERIAL PRIMARY KEY,
                name      TEXT NOT NULL,
                email     TEXT UNIQUE NOT NULL,
                city      TEXT,
                joined_at DATE DEFAULT CURRENT_DATE
            )
        """))
        conn.execute(text("""
            CREATE TABLE products (
                id       SERIAL PRIMARY KEY,
                name     TEXT NOT NULL,
                category TEXT,
                price    NUMERIC(10,2) NOT NULL
            )
        """))
        conn.execute(text("""
            CREATE TABLE orders (
                id          SERIAL PRIMARY KEY,
                customer_id INTEGER REFERENCES customers(id),
                product_id  INTEGER REFERENCES products(id),
                quantity    INTEGER NOT NULL DEFAULT 1,
                ordered_at  DATE DEFAULT CURRENT_DATE,
                status      TEXT DEFAULT 'completed'
            )
        """))
        cur = conn
    else:
        cur = conn.cursor()

    if mode == "sqlite":
        cur.executescript("""
            DROP TABLE IF EXISTS orders;
            DROP TABLE IF EXISTS customers;
            DROP TABLE IF EXISTS products;

            CREATE TABLE customers (
                id        INTEGER PRIMARY KEY,
                name      TEXT NOT NULL,
                email     TEXT UNIQUE NOT NULL,
                city      TEXT,
                joined_at TEXT DEFAULT (date('now'))
            );
            CREATE TABLE products (
                id       INTEGER PRIMARY KEY,
                name     TEXT NOT NULL,
                category TEXT,
                price    REAL NOT NULL
            );
            CREATE TABLE orders (
                id          INTEGER PRIMARY KEY,
                customer_id INTEGER REFERENCES customers(id),
                product_id  INTEGER REFERENCES products(id),
                quantity    INTEGER NOT NULL DEFAULT 1,
                ordered_at  TEXT DEFAULT (date('now')),
                status      TEXT DEFAULT 'completed'
            );
        """)

    # ── Data ──────────────────────────────────────────────────────────────────
    customers = [
        (1, "Alice Martin",   "alice@example.com",    "New York",     "2023-03-15"),
        (2, "Bob Chen",       "bob@example.com",      "San Francisco", "2023-06-01"),
        (3, "Carol Williams", "carol@example.com",    "Chicago",      "2023-08-20"),
        (4, "David Kim",      "david@example.com",    "Austin",       "2024-01-10"),
        (5, "Eva Rossi",      "eva@example.com",      "New York",     "2024-02-28"),
        (6, "Frank Müller",   "frank@example.com",    "Berlin",       "2024-04-05"),
        (7, "Grace Lee",      "grace@example.com",    "Seoul",        "2024-06-18"),
        (8, "Henry Patel",    "henry@example.com",    "London",       "2024-09-30"),
    ]
    products = [
        (1,  "Wireless Headphones", "Electronics",  89.99),
        (2,  "Mechanical Keyboard", "Electronics", 129.00),
        (3,  "USB-C Hub",           "Electronics",  45.50),
        (4,  "Standing Desk",       "Furniture",   349.00),
        (5,  "Ergonomic Chair",     "Furniture",   499.99),
        (6,  "Python Crash Course", "Books",        29.99),
        (7,  "Clean Code",          "Books",        34.95),
        (8,  "Coffee Mug",          "Kitchen",      12.00),
        (9,  "Notebook (A5)",       "Stationery",    6.50),
        (10, "Desk Lamp",           "Electronics",  39.99),
    ]
    orders = [
        (1,  1, 1,  1, "2024-01-05", "completed"),
        (2,  1, 6,  1, "2024-01-12", "completed"),
        (3,  2, 2,  1, "2024-02-03", "completed"),
        (4,  2, 3,  2, "2024-02-03", "completed"),
        (5,  3, 5,  1, "2024-03-22", "completed"),
        (6,  3, 7,  1, "2024-04-01", "completed"),
        (7,  4, 4,  1, "2024-04-14", "completed"),
        (8,  4, 10, 1, "2024-04-14", "completed"),
        (9,  5, 1,  1, "2024-05-09", "completed"),
        (10, 5, 8,  3, "2024-05-09", "completed"),
        (11, 6, 9,  5, "2024-06-30", "completed"),
        (12, 6, 6,  1, "2024-07-01", "completed"),
        (13, 7, 2,  1, "2024-08-15", "completed"),
        (14, 7, 3,  1, "2024-08-15", "completed"),
        (15, 8, 5,  1, "2024-09-02", "shipped"),
        (16, 1, 4,  1, "2024-10-20", "completed"),
        (17, 2, 7,  1, "2024-11-11", "completed"),
        (18, 3, 8,  2, "2024-12-01", "completed"),
        (19, 4, 1,  1, "2024-12-15", "pending"),
        (20, 5, 2,  1, "2024-12-28", "pending"),
    ]

    if mode == "postgres":
        from sqlalchemy import text
        cur.execute(text("INSERT INTO customers (id,name,email,city,joined_at) VALUES (:a,:b,:c,:d,:e)"),
                    [dict(a=r[0],b=r[1],c=r[2],d=r[3],e=r[4]) for r in customers])
        cur.execute(text("INSERT INTO products (id,name,category,price) VALUES (:a,:b,:c,:d)"),
                    [dict(a=r[0],b=r[1],c=r[2],d=r[3]) for r in products])
        cur.execute(text("INSERT INTO orders (id,customer_id,product_id,quantity,ordered_at,status) VALUES (:a,:b,:c,:d,:e,:f)"),
                    [dict(a=r[0],b=r[1],c=r[2],d=r[3],e=r[4],f=r[5]) for r in orders])
        conn.commit()
        conn.close()
        target = DB_URL.split("@")[-1]
    else:
        cur.executemany("INSERT INTO customers VALUES (?,?,?,?,?)", customers)
        cur.executemany("INSERT INTO products VALUES (?,?,?,?)", products)
        cur.executemany("INSERT INTO orders VALUES (?,?,?,?,?,?)", orders)
        conn.commit()
        conn.close()
        target = DB_PATH

    print(f"✅  Demo database seeded → {target}")
    print(f"    customers: {len(customers)} rows")
    print(f"    products:  {len(products)} rows")
    print(f"    orders:    {len(orders)} rows")


if __name__ == "__main__":
    seed()

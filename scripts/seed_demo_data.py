"""
seed_demo_data.py — Populate the demo SQLite database.

Run from the project root:
    python scripts/seed_demo_data.py

Creates three tables:
    customers   — who bought things
    products    — what they bought
    orders      — the transactions linking customers ↔ products
"""

import os
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "data" / "demo.db"


def seed():
    os.makedirs(DB_PATH.parent, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    # ── Drop and recreate tables (idempotent) ─────────────────────────────────
    cur.executescript("""
        DROP TABLE IF EXISTS orders;
        DROP TABLE IF EXISTS customers;
        DROP TABLE IF EXISTS products;

        CREATE TABLE customers (
            id         INTEGER PRIMARY KEY,
            name       TEXT    NOT NULL,
            email      TEXT    UNIQUE NOT NULL,
            city       TEXT,
            joined_at  TEXT    DEFAULT (date('now'))
        );

        CREATE TABLE products (
            id          INTEGER PRIMARY KEY,
            name        TEXT    NOT NULL,
            category    TEXT,
            price       REAL    NOT NULL
        );

        CREATE TABLE orders (
            id           INTEGER PRIMARY KEY,
            customer_id  INTEGER REFERENCES customers(id),
            product_id   INTEGER REFERENCES products(id),
            quantity     INTEGER NOT NULL DEFAULT 1,
            ordered_at   TEXT    DEFAULT (date('now')),
            status       TEXT    DEFAULT 'completed'
        );
    """)

    # ── Customers ─────────────────────────────────────────────────────────────
    customers = [
        (1, "Alice Martin",   "alice@example.com",   "New York",    "2023-03-15"),
        (2, "Bob Chen",       "bob@example.com",     "San Francisco","2023-06-01"),
        (3, "Carol Williams", "carol@example.com",   "Chicago",     "2023-08-20"),
        (4, "David Kim",      "david@example.com",   "Austin",      "2024-01-10"),
        (5, "Eva Rossi",      "eva@example.com",     "New York",    "2024-02-28"),
        (6, "Frank Müller",   "frank@example.com",   "Berlin",      "2024-04-05"),
        (7, "Grace Lee",      "grace@example.com",   "Seoul",       "2024-06-18"),
        (8, "Henry Patel",    "henry@example.com",   "London",      "2024-09-30"),
    ]
    cur.executemany(
        "INSERT INTO customers VALUES (?,?,?,?,?)", customers
    )

    # ── Products ──────────────────────────────────────────────────────────────
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
    cur.executemany(
        "INSERT INTO products VALUES (?,?,?,?)", products
    )

    # ── Orders ────────────────────────────────────────────────────────────────
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
    cur.executemany(
        "INSERT INTO orders VALUES (?,?,?,?,?,?)", orders
    )

    conn.commit()
    conn.close()

    print(f"✅  Demo database seeded at: {DB_PATH}")
    print(f"    customers: {len(customers)} rows")
    print(f"    products:  {len(products)} rows")
    print(f"    orders:    {len(orders)} rows")


if __name__ == "__main__":
    seed()

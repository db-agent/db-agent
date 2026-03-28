"""
seed_demo_data.py — Initialize the demo SQLite database.

Creates customers, products, and orders tables with realistic sample data.
Run from fullstack_app/backend/:

    cd fullstack_app/backend
    python ../scripts/seed_demo_data.py

Or from fullstack_app/:

    cd fullstack_app
    python scripts/seed_demo_data.py

The DB_URL defaults to sqlite:///./data/demo.db — relative to wherever
you run the script, which should match where you run uvicorn.
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

from sqlalchemy import create_engine, text

DB_URL = os.getenv("DB_URL", "sqlite:///./data/demo.db")

# Ensure data directory exists
os.makedirs("data", exist_ok=True)

engine = create_engine(DB_URL, connect_args={"check_same_thread": False})

SCHEMA = """
CREATE TABLE IF NOT EXISTS customers (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    email       TEXT UNIQUE NOT NULL,
    city        TEXT NOT NULL,
    joined_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    category    TEXT NOT NULL,
    price       REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
    id          INTEGER PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    product_id  INTEGER NOT NULL REFERENCES products(id),
    quantity    INTEGER NOT NULL DEFAULT 1,
    ordered_at  TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'completed'
);
"""

CUSTOMERS = [
    (1, "Alice Johnson",  "alice@example.com",  "New York",    "2023-01-15"),
    (2, "Bob Smith",      "bob@example.com",     "Chicago",     "2023-02-20"),
    (3, "Carol White",    "carol@example.com",   "Los Angeles", "2023-03-05"),
    (4, "David Brown",    "david@example.com",   "Houston",     "2023-04-12"),
    (5, "Eva Martinez",   "eva@example.com",     "Phoenix",     "2023-05-18"),
    (6, "Frank Lee",      "frank@example.com",   "New York",    "2023-06-22"),
    (7, "Grace Kim",      "grace@example.com",   "Chicago",     "2023-07-30"),
    (8, "Henry Davis",    "henry@example.com",   "Los Angeles", "2023-08-14"),
]

PRODUCTS = [
    (1,  "Laptop Pro 15",    "Electronics",  1299.99),
    (2,  "Wireless Mouse",   "Electronics",    29.99),
    (3,  "Office Chair",     "Furniture",     349.99),
    (4,  "Standing Desk",    "Furniture",     599.99),
    (5,  "Python Handbook",  "Books",          39.99),
    (6,  "SQL Deep Dive",    "Books",          34.99),
    (7,  "Monitor 27in",     "Electronics",   449.99),
    (8,  "Mechanical Keyboard","Electronics",  129.99),
    (9,  "Webcam HD",        "Electronics",    79.99),
    (10, "Desk Lamp",        "Furniture",      49.99),
]

ORDERS = [
    (1,  1, 1, 1, "2024-01-10", "completed"),
    (2,  2, 2, 2, "2024-01-12", "completed"),
    (3,  3, 3, 1, "2024-01-15", "completed"),
    (4,  1, 5, 1, "2024-01-20", "completed"),
    (5,  4, 7, 1, "2024-01-22", "completed"),
    (6,  5, 8, 1, "2024-02-01", "completed"),
    (7,  6, 4, 1, "2024-02-05", "completed"),
    (8,  2, 1, 1, "2024-02-10", "completed"),
    (9,  7, 6, 2, "2024-02-14", "completed"),
    (10, 3, 9, 1, "2024-02-18", "completed"),
    (11, 8, 2, 3, "2024-02-20", "completed"),
    (12, 1, 3, 1, "2024-02-25", "completed"),
    (13, 4, 5, 2, "2024-03-01", "completed"),
    (14, 5, 10,1, "2024-03-05", "completed"),
    (15, 6, 8, 1, "2024-03-10", "pending"),
    (16, 7, 1, 1, "2024-03-12", "pending"),
    (17, 2, 7, 1, "2024-03-15", "pending"),
    (18, 3, 4, 1, "2024-03-18", "completed"),
    (19, 8, 6, 1, "2024-03-20", "completed"),
    (20, 1, 2, 2, "2024-03-22", "completed"),
]

with engine.connect() as conn:
    for statement in SCHEMA.strip().split(";"):
        stmt = statement.strip()
        if stmt:
            conn.execute(text(stmt))

    conn.execute(text("DELETE FROM orders"))
    conn.execute(text("DELETE FROM products"))
    conn.execute(text("DELETE FROM customers"))

    conn.execute(
        text("INSERT INTO customers VALUES (:id,:name,:email,:city,:joined_at)"),
        [dict(zip(["id","name","email","city","joined_at"], row)) for row in CUSTOMERS],
    )
    conn.execute(
        text("INSERT INTO products VALUES (:id,:name,:category,:price)"),
        [dict(zip(["id","name","category","price"], row)) for row in PRODUCTS],
    )
    conn.execute(
        text("INSERT INTO orders VALUES (:id,:customer_id,:product_id,:quantity,:ordered_at,:status)"),
        [dict(zip(["id","customer_id","product_id","quantity","ordered_at","status"], row)) for row in ORDERS],
    )
    conn.commit()

print(f"Demo database seeded at: {DB_URL}")
print(f"  customers: {len(CUSTOMERS)} rows")
print(f"  products:  {len(PRODUCTS)} rows")
print(f"  orders:    {len(ORDERS)} rows")

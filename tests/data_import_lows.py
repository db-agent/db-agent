import kagglehub
import os
import subprocess
import psycopg2
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT

# PostgreSQL credentials
PG_HOST = "postgres"
PG_PORT = 5432
PG_USER = "postgres"
PG_PASSWORD = "postgres"
PG_DATABASE = "db-lows-sku"

# Kaggle dataset identifier
KAGGLE_DATASET = "polartech/40000-home-appliance-sku-data-from-lowescom"

# Table creation SQL
CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS home_appliance_sku (
    id SERIAL PRIMARY KEY,
    sku_id TEXT,
    product_name TEXT,
    category TEXT,
    sub_category TEXT,
    price FLOAT,
    rating FLOAT,
    review_count INTEGER,
    availability TEXT
);
"""

def create_database():
    print("Creating PostgreSQL database if it does not exist...")
    conn = psycopg2.connect(
        host=PG_HOST,
        port=PG_PORT,
        user=PG_USER,
        password=PG_PASSWORD,
    )
    conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)  # Required for database creation
    cursor = conn.cursor()

    # Check if database exists and create it if not
    cursor.execute(f"SELECT 1 FROM pg_database WHERE datname = '{PG_DATABASE}';")
    if not cursor.fetchone():
        cursor.execute(f"CREATE DATABASE \"{PG_DATABASE}\";")
        print(f"Database '{PG_DATABASE}' created successfully.")
    else:
        print(f"Database '{PG_DATABASE}' already exists.")

    cursor.close()
    conn.close()

def download_dataset():
    print("Downloading dataset from Kaggle...")
    dataset_path = kagglehub.dataset_download(KAGGLE_DATASET)
    print(f"Dataset downloaded to: {dataset_path}")
    return dataset_path

def convert_to_utf8(file_path, output_path):
    print("Converting dataset to UTF-8 encoding...")
    subprocess.run(["iconv", "-f", "ISO-8859-1", "-t", "UTF-8", file_path, "-o", output_path], check=True)
    print(f"Converted dataset saved to: {output_path}")

def create_table_and_import_data(dataset_path):
    print("Connecting to PostgreSQL database...")
    conn = psycopg2.connect(
        host=PG_HOST,
        port=PG_PORT,
        user=PG_USER,
        password=PG_PASSWORD,
        database=PG_DATABASE
    )
    cursor = conn.cursor()

    print("Creating table if it does not exist...")
    cursor.execute(CREATE_TABLE_SQL)

    print("Importing dataset into PostgreSQL...")
    with open(dataset_path, 'r', encoding='utf-8') as f:
        cursor.copy_expert(f"""
        COPY home_appliance_sku(sku_id, product_name, category, sub_category, price, rating, review_count, availability)
        FROM STDIN
        DELIMITER ','
        CSV HEADER;
        """, f)

    conn.commit()
    cursor.close()
    conn.close()
    print("Data successfully imported into PostgreSQL.")

if __name__ == "__main__":
    # Step 1: Create database
    create_database()

    # Step 2: Download dataset
    dataset_dir = download_dataset()

    # Step 3: Locate CSV file in the downloaded path
    csv_file = os.path.join(dataset_dir, "home_appliance_sku_data.csv")
    utf8_file = os.path.join(dataset_dir, "home_appliance_sku_data_utf8.csv")

    # Step 4: Convert to UTF-8
    convert_to_utf8(csv_file, utf8_file)

    # Step 5: Create table and import data into PostgreSQL
    create_table_and_import_data(utf8_file)

    print("All steps completed successfully!")

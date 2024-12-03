import kagglehub
import os
import pandas as pd
import psycopg2
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT
import subprocess

# PostgreSQL credentials
PG_HOST = "localhost"
PG_PORT = 5432
PG_USER = "postgres"
PG_PASSWORD = "postgres"
PG_DATABASE = "db-lows-sku"

# Kaggle dataset identifier
KAGGLE_DATASET = "polartech/40000-home-appliance-sku-data-from-lowescom"

# Table creation SQL
CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS home_appliance_sku (
    category TEXT,
    date_scraped TIMESTAMP,
    sort_by TEXT,
    run_start_date TIMESTAMP,
    subcategory TEXT,
    shipping_location TEXT,
    sku TEXT PRIMARY KEY,
    country TEXT,
    brand TEXT,
    price_retail FLOAT,
    price_current FLOAT,
    seller TEXT,
    product_url TEXT,
    currency TEXT,
    breadcrumbs TEXT,
    department TEXT,
    promotion TEXT,
    bestseller_rank INTEGER,
    product_name TEXT,
    website_url TEXT
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
    conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
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

def locate_csv_file(dataset_dir):
    print("Locating CSV file in the dataset directory...")
    files = os.listdir(dataset_dir)
    csv_files = [f for f in files if f.endswith('.csv')]
    if not csv_files:
        raise FileNotFoundError("No CSV file found in the downloaded dataset directory.")
    print(f"Found CSV file: {csv_files[0]}")
    return os.path.join(dataset_dir, csv_files[0])

def convert_to_utf8(file_path, output_path):
    print("Converting dataset to UTF-8 encoding...")
    subprocess.run(["iconv", "-f", "ISO-8859-1", "-t", "UTF-8", file_path, "-o", output_path], check=True)
    print(f"Converted dataset saved to: {output_path}")

def remove_duplicates(input_file, output_file):
    print("Removing duplicates from the dataset...")
    # Load the dataset
    df = pd.read_csv(input_file)
    # Drop duplicate rows based on the 'sku' column
    df = df.drop_duplicates(subset=['SKU'])
    # Save the cleaned dataset to a new file
    df.to_csv(output_file, index=False)
    print(f"Duplicates removed. Cleaned file saved to: {output_file}")

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
        COPY home_appliance_sku(category, date_scraped, sort_by, run_start_date, subcategory, shipping_location, sku, country, brand, price_retail, price_current, seller, product_url, currency, breadcrumbs, department, promotion, bestseller_rank, product_name, website_url)
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
    csv_file = locate_csv_file(dataset_dir)
    utf8_file = os.path.splitext(csv_file)[0] + "_utf8.csv"

    # Step 4: Convert to UTF-8
    convert_to_utf8(csv_file, utf8_file)

    # Step 5: Remove duplicates
    cleaned_file = os.path.splitext(utf8_file)[0] + "_cleaned.csv"
    remove_duplicates(utf8_file, cleaned_file)

    # Step 6: Create table and import data into PostgreSQL
    create_table_and_import_data(cleaned_file)

    print("All steps completed successfully!")

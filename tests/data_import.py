import os
import subprocess
import kagglehub
import psycopg2

# PostgreSQL credentials
PG_HOST = "postgres"
PG_PORT = 5432
PG_USER = "datapilot"
PG_PASSWORD = "datapilot"
PG_DATABASE = "datapilot"

# Kaggle dataset identifier
KAGGLE_DATASET = "shashwatwork/dataco-smart-supply-chain-for-big-data-analysis"

# Table creation SQL
CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS sales_data (
    type TEXT,
    days_for_shipping_real INTEGER,
    days_for_shipment_scheduled INTEGER,
    benefit_per_order FLOAT,
    sales_per_customer FLOAT,
    delivery_status TEXT,
    late_delivery_risk INTEGER,
    category_id INTEGER,
    category_name TEXT,
    customer_city TEXT,
    customer_country TEXT,
    customer_email TEXT,
    customer_fname TEXT,
    customer_id INTEGER,
    customer_lname TEXT,
    customer_password TEXT,
    customer_segment TEXT,
    customer_state TEXT,
    customer_street TEXT,
    customer_zipcode TEXT,
    department_id INTEGER,
    department_name TEXT,
    latitude FLOAT,
    longitude FLOAT,
    market TEXT,
    order_city TEXT,
    order_country TEXT,
    order_customer_id INTEGER,
    order_date DATE,
    order_id INTEGER,
    order_item_cardprod_id INTEGER,
    order_item_discount FLOAT,
    order_item_discount_rate FLOAT,
    order_item_id INTEGER,
    order_item_product_price FLOAT,
    order_item_profit_ratio FLOAT,
    order_item_quantity INTEGER,
    sales FLOAT,
    order_item_total FLOAT,
    order_profit_per_order FLOAT,
    order_region TEXT,
    order_state TEXT,
    order_status TEXT,
    order_zipcode TEXT,
    product_card_id INTEGER,
    product_category_id INTEGER,
    product_description TEXT,
    product_image TEXT,
    product_name TEXT,
    product_price FLOAT,
    product_status TEXT,
    shipping_date DATE,
    shipping_mode TEXT
);
"""

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
        COPY sales_data
        FROM STDIN
        DELIMITER ','
        CSV HEADER;
        """, f)

    conn.commit()
    cursor.close()
    conn.close()
    print("Data successfully imported into PostgreSQL.")

if __name__ == "__main__":
    # Step 1: Download dataset
    dataset_dir = download_dataset()

    # Step 2: Locate CSV file in the downloaded path
    csv_file = os.path.join(dataset_dir, "DataCoSupplyChainDataset.csv")
    utf8_file = os.path.join(dataset_dir, "DataCoSupplyChainDataset_utf8.csv")

    # Step 3: Convert to UTF-8
    convert_to_utf8(csv_file, utf8_file)

    # Step 4: Create table and import data into PostgreSQL
    create_table_and_import_data(utf8_file)

    print("All steps completed successfully!")

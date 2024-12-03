## Setup Test environment with Supply Chain Data from Kaggle

### Test queries ( Sales Data )

- most frequent customer states
- highest sales customer
- most common order region
- show all  PENDING order_status 
- top 5 highest selling products
- Least popular products

### Test queries ( SKU Data )

- Find all SKUs that are out of stock or unavailable.
- Show me the top 10 most expensive products
- Which brands offer products in multiple categories?
- Which categories have products available in the USA but not in Canada?
- What products are currently on promotion?
- List all products with discounts and their percentage discounts.
- What are the best products in each category based on their bestseller rank?

- Download the data

- Login to your local PostgreSQL DB

```
PGPASSWORD=mypassword psql -h localhost -U myuser -d mydatabase -p 5432

```

- Create table into your existing Databse

```
COPY sales_data(
    type,
    days_for_shipping_real,
    days_for_shipment_scheduled,
    benefit_per_order,
    sales_per_customer,
    delivery_status,
    late_delivery_risk,
    category_id,
    category_name,
    customer_city,
    customer_country,
    customer_email,
    customer_fname,
    customer_id,
    customer_lname,
    customer_password,
    customer_segment,
    customer_state,
    customer_street,
    customer_zipcode,
    department_id,
    department_name,
    latitude,
    longitude,
    market,
    order_city,
    order_country,
    order_customer_id,
    order_date,
    order_id,
    order_item_cardprod_id,
    order_item_discount,
    order_item_discount_rate,
    order_item_id,
    order_item_product_price,
    order_item_profit_ratio,
    order_item_quantity,
    sales,
    order_item_total,
    order_profit_per_order,
    order_region,
    order_state,
    order_status,
    order_zipcode,
    product_card_id,
    product_category_id,
    product_description,
    product_image,
    product_name,
    product_price,
    product_status,
    shipping_date,
    shipping_mode
)
FROM '/path/to/data.csv' 
DELIMITER ',' 
CSV HEADER;


```

- Copy the data into the table ( ensure file is in utf-8 format)
```
\COPY sales_data FROM 'Downloads/supply_chain_data/DataCoSupplyChainDataset_utf8.csv' DELIMITER ',' CSV HEADER;

```


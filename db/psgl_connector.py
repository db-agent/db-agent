import psycopg2

def fetch_schema(host, database, username, password):
    """
    Fetch PostgreSQL database schema.

    Args:
    - host (str): Database host.
    - database (str): Database name.
    - username (str): Database username.
    - password (str): Database password.

    Returns:
    - schema (dict): Dictionary containing table names as keys and column information as values.
    """

    # Establish database connection
    conn = psycopg2.connect(
        host=host,
        database=database,
        user=username,
        password=password
    )

    cur = conn.cursor()

    # Get table names
    cur.execute("""
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema='public' 
        AND table_type='BASE TABLE';
    """)
    tables = cur.fetchall()

    schema = {}
    for table in tables:
        table_name = table[0]
        
        # Get column information for each table
        cur.execute(f"""
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name='{table_name}';
        """)
        columns = cur.fetchall()
        
        schema[table_name] = columns

    # Close database connection
    conn.close()
    
    return schema


# Example usage
if __name__ == "__main__":
    host = 'localhost'
    database = 'mydatabase'
    username = 'myuser'
    password = 'mypassword'

    schema = fetch_schema(host, database, username, password)

    for table, columns in schema.items():
        print(f"Table: {table}")
        for column in columns:
            print(f"  {column[0]} ({column[1]})")
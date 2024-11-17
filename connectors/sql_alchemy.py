from sqlalchemy import create_engine, text, inspect
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import pandas as pd
import os
from dotenv import load_dotenv

load_dotenv(override=True)

engine_uri = {
    "mysql": "mysql+pymysql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}",
    "postgres": "postgresql+psycopg2://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}",
    "mssql": "mssql+pymssql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}",
    "oracle": "oracle+cx_oracle://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
}

class SqlAlchemy:
    def __init__(self):
        load_dotenv(override=True)
        
        # Load environment variables with defaults
        self.DB_HOST = os.getenv("DB_HOST", "localhost")
        self.DB_USER = os.getenv("DB_USER", "user")
        self.DB_PASSWORD = os.getenv("DB_PASSWORD", "password")
        self.DB_NAME = os.getenv("DB_NAME", "database")
        self.DB_PORT = os.getenv("DB_PORT", "5432")
        self.DB_DRIVER = os.getenv("DB_DRIVER", "postgres")

        # Construct the connection string based on the DB_DRIVER
        connection_string_template = engine_uri.get(self.DB_DRIVER)
        if not connection_string_template:
            raise ValueError(f"Unsupported database driver: {self.DB_DRIVER}")

        try:
            self.CONNECTION_STRING = connection_string_template.format(
                DB_USER=self.DB_USER or "user",
                DB_PASSWORD=self.DB_PASSWORD or "password",
                DB_HOST=self.DB_HOST or "localhost",
                DB_PORT=self.DB_PORT or "5432",
                DB_NAME=self.DB_NAME or "database"
            )
        except KeyError as e:
            raise ValueError(f"Missing configuration for {e}")

        # Create the SQLAlchemy engine
        try:
            self.engine = create_engine(self.CONNECTION_STRING)
            self.base = declarative_base()
        except Exception as e:
            raise ConnectionError(f"Failed to create SQLAlchemy engine: {e}")

    def run_query(self, query):
        try:
            Session = sessionmaker(bind=self.engine)
            session = Session()
            query_result = session.execute(text(query))
            query_result_to_df = pd.DataFrame(query_result.fetchall(), columns=query_result.keys())
            print(query_result_to_df)
            return query_result_to_df
        except Exception as e:
            return f"An error occurred: {e}"
        finally:
            session.close()

    def get_db_schema(self):
        schema_info = ""
        try:
            inspector = inspect(self.engine)
            tables = inspector.get_table_names(schema="public")
            for table_name in tables:
                columns = inspector.get_columns(table_name, schema="public")
                schema_info += f"Table: {table_name.upper()}\n"
                for column in columns:
                    column_name = column["name"]
                    data_type = column["type"]
                    schema_info += f"  Column: {column_name}, Type: {data_type}\n"
                schema_info += "\n"
        except Exception as e:
            schema_info = f"Error retrieving schema: {e}"
        return schema_info

from sqlalchemy import create_engine, text, inspect
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import pandas as pd

engine_uri = {
    "mysql": "mysql+pymysql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}",
    "postgres": "postgresql+psycopg2://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}",
    "mssql": "mssql+pymssql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}",
    "oracle": "oracle+cx_oracle://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
}

class SqlAlchemy:
    def __init__(self, config_loader):
        self.DB_HOST = config_loader.get_key("DB_HOST")
        self.DB_USER = config_loader.get_key("DB_USER")
        self.DB_PASSWORD = config_loader.get_key("DB_PASSWORD")
        self.DB_NAME = config_loader.get_key("DB_NAME")
        self.DB_PORT = config_loader.get_key("DB_PORT")
        self.DB_DRIVER = config_loader.get_key("DB_DRIVER")

        # Construct the connection string based on the DB_DRIVER
        connection_string_template = engine_uri.get(self.DB_DRIVER)
        if not connection_string_template:
            raise ValueError(f"Unsupported database driver: {self.DB_DRIVER}")
        
        self.CONNECTION_STRING = connection_string_template.format(
            DB_USER=self.DB_USER,
            DB_PASSWORD=self.DB_PASSWORD,
            DB_HOST=self.DB_HOST,
            DB_PORT=self.DB_PORT,
            DB_NAME=self.DB_NAME
        )

        # Create the SQLAlchemy engine
        self.engine = create_engine(self.CONNECTION_STRING)
        self.base = declarative_base()   
    
    def run_query(self,query):
        try:
            Session = sessionmaker(bind=self.engine)
            session = Session()
            query_result = session.execute(text(query))
  
            query_result_to_df = pd.DataFrame(query_result.fetchall(),columns=query_result.keys())
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
            # schema_info += "Database Schema:\n\n"
            tables = inspector.get_table_names(schema='public')
            for table_name in tables:
                # Get columns for each table
                columns = inspector.get_columns(table_name, schema='public')
                schema_info += f"{table_name.upper()}\n\n"
                for column in columns:
                    column_name = column['name']
                    data_type = column['type']
                    schema_info += f"Table: {table_name}, Column: {column_name}, Type: {data_type}\n"
                
                schema_info += "\n\n"

        except Exception as e:
            schema_info = f"Error retrieving schema: {e}"        
        return schema_info

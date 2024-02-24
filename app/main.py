import sys,os
from pathlib import Path

# Add the project root directory to the Python path
project_root = Path(__file__).parent.parent
sys.path.append(str(project_root))

from config_loader import ConfigLoader
from db.db_manager import DatabaseManager
from services.db_service import DBService
from services.openai_service import OpenAIInterface

from langchain.chains import create_sql_query_chain
from langchain_openai import ChatOpenAI
from langchain_community.utilities import SQLDatabase

def main():
    # Load configurations
    config_loader = ConfigLoader()
    db_config = config_loader.db_config
    openai_api_key = config_loader.openai_api_key

    # Initialize database manager with MySQL connector
    db_manager = DatabaseManager('mysql', db_config)

    # Initialize services
    db_service = DBService(db_manager)
    openai_service = OpenAIInterface(openai_api_key)
    os.environ["OPENAI_API_KEY"] = openai_api_key
    db = SQLDatabase.from_uri(
    f"mysql://{db_config['user']}:"
    f"{db_config['password']}@"
    f"{db_config['host']}:3306/"
    f"{db_config['database']}")

    print(db.dialect)
    print(db.get_usable_table_names())
    llm = ChatOpenAI(model="gpt-3.5-turbo", temperature=0)
    chain = create_sql_query_chain(llm, db)
    response = chain.invoke({"question": "Show top 10 Part number from inventory history"})
    print(response)
    print(db.run(response))

    # Clean up resources
    db_manager.close()

if __name__ == "__main__":
    main()

from config_loader import ConfigLoader
from db.db_manager import DatabaseManager
from services.db_service import DBService
from services.openai_service import OpenAIInterface

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

    # Example application flow
    # 1. Get a query from the user
    user_query = input("Enter your query: ")

    # 2. Use OpenAI service to generate a response
    response = openai_service.generate_text(user_query)

    # 3. Store the query and response in the database
    db_service.insert_response(user_query, response)

    # 4. Fetch and display the response
    fetched_response = db_service.fetch_response_by_query(user_query)
    print("Response from OpenAI:", fetched_response)

    # Clean up resources
    db_manager.close()

if __name__ == "__main__":
    main()

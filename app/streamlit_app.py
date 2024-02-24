import streamlit as st
from app.config_loader import ConfigLoader
from db.db_manager import DatabaseManager
from services.db_service import DBService
from services.openai_service import OpenAIInterface

# Initialize configuration and services
config_loader = ConfigLoader()
db_manager = DatabaseManager('mysql', config_loader.db_config)
db_service = DBService(db_manager)
openai_service = OpenAIInterface(config_loader.openai_api_key)

# Streamlit UI
st.title("LangChain Application")

user_query = st.text_input("Enter your query:", "")

if st.button("Generate Response"):
    if user_query:
        # Use OpenAI service to generate a response
        response = openai_service.generate_text(user_query)
        
        # Store the query and response in the database
        db_service.insert_response(user_query, response)
        
        # Display the response
        st.text_area("Response:", value=response, height=200)
    else:
        st.error("Please enter a query.")

# Optional: Add more interactive elements or data visualizations as needed

# Clean up resources on script rerun or exit
def on_exit():
    db_manager.close()

st.on_session_end(on_exit)

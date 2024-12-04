import streamlit as st
import pandas as pd
from connectors.sql_alchemy import SqlAlchemy
from textgen.factory import LLMClientFactory

from helpers.query_history import * 
from helpers.config_store import *
from helpers.css_settings import *
from helpers.dp_charts import *
import logging
import time
import os
from dotenv import load_dotenv

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.FileHandler("application.log"),  # Logs to a file
        logging.StreamHandler()  # Logs to stdout
    ]
)

logger = logging.getLogger(__name__)
logger.info("Logging initialized successfully!")

load_dotenv()


# Streamlit App Interface
st.title("Talk to your DB in Natural Language")
st.markdown(custom_css, unsafe_allow_html=True)


# Initialize query history in session state
if "query_history" not in st.session_state:
    st.session_state["query_history"] = load_query_history()

if "config" not in st.session_state:
    st.session_state["config"] = load_from_env()


with st.sidebar:
    with st.expander("Database Configuration"):
        st.session_state.config = load_from_env()
        db_options = ["postgres", "mysql", "mssql", "oracle"]

        st.session_state.config["DB_DRIVER"] = st.selectbox(
            "SELECT DATABASE:", db_options,
            db_options.index(st.session_state.config["DB_DRIVER"])
        )
        st.session_state.config["DB_HOST"] = st.text_input(
            "DB_HOST:", st.session_state.config["DB_HOST"]
        )
        st.session_state.config["DB_PORT"] = st.text_input(
            "DB_PORT:", st.session_state.config["DB_PORT"]
        )
        st.session_state.config["DB_USER"] = st.text_input(
            "DB_USER:", st.session_state.config["DB_USER"]
        )
        st.session_state.config["DB_PASSWORD"] = st.text_input(
            "DB_PASS:", st.session_state.config["DB_PASSWORD"]
        )
        st.session_state.config["DB_NAME"] = st.text_input(
            "DB_NAME:", st.session_state.config["DB_NAME"]
        )
        
        if st.button("Save DB Config"):
            save_to_env(st.session_state["config"])
            st.success("Database configuration saved!")

    with st.expander("Model Selection"):
        st.session_state["config"] = load_from_env()

        # Define supported models for each backend
        supported_models = {
            "huggingface": ["defog/llama-3-sqlcoder-8b", "defog/sqlcoder-70b-alpha"],
            "ollama": ["hf.co/defog/sqlcoder-7b-2"],
            "vllm": ["google/codegemma-7b-it"]
        }

        llm_backend = [
            "huggingface",
            "ollama",
            "vllm"
        ]

        # Dropdown to select the backend
        st.session_state.config["LLM_BACKEND"] = st.selectbox(
            "LLM_BACKEND:", 
            llm_backend, 
            index=llm_backend.index(st.session_state.config.get("LLM_BACKEND", llm_backend[0]))
        )

        # Dynamically update model options based on selected backend
        selected_backend = st.session_state.config["LLM_BACKEND"]
        filtered_model_options = supported_models.get(selected_backend, [])

        # Dropdown to select the model
        st.session_state.config["MODEL"] = st.selectbox(
            "SELECT Model:", 
            filtered_model_options, 
            index=filtered_model_options.index(st.session_state.config.get("MODEL", filtered_model_options[0])) 
            if filtered_model_options else 0
        )

        # Input for API key
        st.session_state.config["LLM_API_KEY"] = st.text_input(
            "API KEY:", 
            value=st.session_state.config.get("LLM_API_KEY", "")
        )
        
        # Input for LLM endpoint
        st.session_state.config["LLM_ENDPOINT"] = st.text_input(
            "LLM_ENDPOINT:", 
            value=st.session_state.config.get("LLM_ENDPOINT", "")
        )

        if st.button("Save LLM Config"):
            save_to_env(st.session_state.config)

        
    with st.expander("Show Database Schema"):
        sql_alchemy = SqlAlchemy()
        schema_info = sql_alchemy.get_db_schema()
        st.text(schema_info)


nl_query = st.text_area("Ask a question about your data:")


if st.button("▶️  Execute"):

    if nl_query:
        model_name=st.session_state.config.get("MODEL")
        backend = st.session_state.config.get('LLM_BACKEND')


        with st.spinner(f"Generating SQL Query using {model_name}"):
            inference_client = LLMClientFactory.get_client(
                backend = st.session_state.config.get('LLM_BACKEND'),
                server_url = st.session_state.config.get('LLM_ENDPOINT'),
                model_name = st.session_state.config.get("MODEL")
            )
        
        sql_query=inference_client.generate_sql(nl_query,schema_info)

        st.text(f"Generated SQL Query: LLM backend {backend} serving {model_name}")
        st.code(sql_query, language="sql")

        st.session_state.query_history.append((nl_query, sql_query))
        save_query_history(st.session_state["query_history"])


        with st.spinner(f"Executing SQL on {st.session_state.config['DB_DRIVER']}"):
            query_result = sql_alchemy.run_query(sql_query)
            if isinstance(query_result, str):
                st.error(f"Error: {query_result}")
            else:
                st.success("Query executed successfully!")
                if isinstance(query_result, pd.DataFrame) and not query_result.empty:
                    st.subheader("Query Results")
                    st.dataframe(query_result)
              
    else:
        st.warning("Please enter a natural language query.")

display_query_history()

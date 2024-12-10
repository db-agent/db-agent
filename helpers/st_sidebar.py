import streamlit as st
from dotenv import load_dotenv
from .query_history import * 
from .config_store import *
from .css_settings import *
from .dp_charts import *
from connectors.sql_alchemy import SqlAlchemy

def display_sidebar():
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
                "huggingface": ["defog/llama-3-sqlcoder-8b",
                                "defog/sqlcoder-70b-alpha",
                                "microsoft/Phi-3.5-mini-instruct",
                                "google/gemma-2-2b-it",
                                "meta-llama/Llama-3.2-1B-Instruct",
                                "meta-llama/Llama-3.3-70B-Instruct"],
                "ollama": ["hf.co/defog/sqlcoder-7b-2","llama3.3"],
                "vllm": ["microsoft/Phi-3.5-mini-instruct", 
                        "google/gemma-2-2b-it",
                        "meta-llama/Llama-3.3-70B-Instruct"]
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
            
            token_size = st.slider("Total Token Size", 512, 1024, 2048)
            # st.write("I'm ", token_size, "years old")
            st.session_state.config["LLM_TOKEN_SIZE"] =  token_size

            if st.button("Save LLM Config"):
                save_to_env(st.session_state.config)
                st.success("LLM configuration saved!")

            
        with st.expander("Show Database Schema"):
            sql_alchemy = SqlAlchemy()
            schema_info = sql_alchemy.get_db_schema()
            st.text(schema_info)

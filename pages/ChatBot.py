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

st.set_page_config(page_title="ChatBot", page_icon="assets/logo.png")
st.title("Yet Another ChatBot 🤖")
st.markdown(custom_css, unsafe_allow_html=True)


with st.sidebar:
    st.page_link('db-agent.py', label='DB Agent', icon='📊')
    st.page_link('pages/ChatBot.py', label='Yet Another ChatBot', icon='🤖')


# Streamlit App Interface


# Initialize query history in session state
if "query_history" not in st.session_state:
    st.session_state["query_history"] = load_query_history()

if "config" not in st.session_state:
    st.session_state["config"] = load_from_env()


with st.sidebar:
    
    with st.expander("Model Selection"):
        st.session_state["config"] = load_from_env()

        # Define supported models for each backend
        supported_models = {
            "huggingface": ["meta-llama/Llama-3.2-1B-Instruct",
                            "defog/llama-3-sqlcoder-8b",
                            "defog/sqlcoder-70b-alpha",
                            "microsoft/Phi-3.5-mini-instruct",
                            "google/gemma-2-2b-it"],
            "ollama": ["hf.co/defog/sqlcoder-7b-2"],
            "vllm": ["microsoft/Phi-3.5-mini-instruct", 
                    "google/gemma-2-2b-it"]
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
            st.success("LLM configuration saved!")

        
    

nl_query = st.text_area("Ask your question")


if st.button("▶️  Send  Query"):

    if nl_query:
        model_name=st.session_state.config.get("MODEL")
        backend = st.session_state.config.get('LLM_BACKEND')


        with st.spinner(f"Reponse {model_name}"):
            inference_client = LLMClientFactory.get_client(
                backend = st.session_state.config.get('LLM_BACKEND'),
                server_url = st.session_state.config.get('LLM_ENDPOINT'),
                model_name = st.session_state.config.get("MODEL")
            )
        
        response=inference_client.generate_generic_response(nl_query)

        st.text(f"Response: LLM backend {backend} serving {model_name}")
        st.markdown(response)

        # st.session_state.query_history.append((nl_query, response))
        # save_query_history(st.session_state["query_history"])


              
    else:
        st.warning("Please enter a natural language query.")

display_query_history()

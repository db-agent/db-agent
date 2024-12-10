import streamlit as st
import pandas as pd
from connectors.sql_alchemy import SqlAlchemy
from textgen.factory import LLMClientFactory

from helpers.query_history import * 
from helpers.config_store import *
from helpers.css_settings import *
from helpers.dp_charts import *
from helpers.st_sidebar import *

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

st.set_page_config(page_title="DB Agent",page_icon="assets/logo.png")

# Streamlit App Interface
st.title("Talk to your DB in Natural Language")

st.markdown(custom_css, unsafe_allow_html=True)
with st.sidebar:
    st.page_link('db-agent.py', label='DB Agent', icon='📊')
    st.page_link('pages/ChatBot.py', label='Yet Another ChatBot', icon='🤖')




# Initialize query history in session state
if "query_history" not in st.session_state:
    st.session_state["query_history"] = load_query_history()

if "config" not in st.session_state:
    st.session_state["config"] = load_from_env()


display_sidebar()


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

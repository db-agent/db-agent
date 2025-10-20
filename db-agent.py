import logging

import pandas as pd
import streamlit as st
from dotenv import load_dotenv

from agent_runtime import (
    AgentOrchestrator,
    AgentRuntimeClient,
    ConfigService,
    OrchestratorEventType,
    ToolRegistry,
    register_default_tools,
)
from helpers.config_store import load_from_env, save_to_env
from helpers.css_settings import custom_css
from helpers.query_history import display_query_history, load_query_history, save_query_history
from helpers.supported_models import llm_backend, supported_models

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.FileHandler("application.log"),
        logging.StreamHandler(),
    ],
)

logger = logging.getLogger(__name__)
logger.info("Logging initialized successfully!")

load_dotenv()

st.title("Talk to your DB in Natural Language")
st.markdown(custom_css, unsafe_allow_html=True)

with st.sidebar:
    st.page_link("db-agent.py", label="DB Agent", icon="📊")
    st.page_link("pages/ChatBot.py", label="Yet Another ChatBot", icon="🤖")

# Initialize session state
if "query_history" not in st.session_state:
    st.session_state["query_history"] = load_query_history()

if "config" not in st.session_state:
    st.session_state["config"] = load_from_env()

if "config_service" not in st.session_state:
    st.session_state["config_service"] = ConfigService(st.session_state["config"])
else:
    st.session_state["config_service"].update(st.session_state["config"])

if "tool_registry" not in st.session_state:
    registry = ToolRegistry()
    register_default_tools(
        config_service=st.session_state["config_service"],
        registry=registry,
    )
    st.session_state["tool_registry"] = registry

if "runtime_client" not in st.session_state:
    orchestrator = AgentOrchestrator(
        config_service=st.session_state["config_service"],
        tool_registry=st.session_state["tool_registry"],
    )
    st.session_state["runtime_client"] = AgentRuntimeClient(orchestrator)

config = st.session_state["config"]
config_service: ConfigService = st.session_state["config_service"]
runtime_client: AgentRuntimeClient = st.session_state["runtime_client"]

with st.sidebar:
    with st.expander("Database Configuration"):
        db_options = ["postgres", "mysql", "mssql", "oracle"]
        current_driver = config.get("DB_DRIVER", db_options[0])
        driver_index = db_options.index(current_driver) if current_driver in db_options else 0
        config["DB_DRIVER"] = st.selectbox("SELECT DATABASE:", db_options, index=driver_index)
        config["DB_HOST"] = st.text_input("DB_HOST:", value=config.get("DB_HOST", "") or "")
        config["DB_PORT"] = st.text_input("DB_PORT:", value=config.get("DB_PORT", "") or "")
        config["DB_USER"] = st.text_input("DB_USER:", value=config.get("DB_USER", "") or "")
        config["DB_PASSWORD"] = st.text_input("DB_PASS:", value=config.get("DB_PASSWORD", "") or "")
        config["DB_NAME"] = st.text_input("DB_NAME:", value=config.get("DB_NAME", "") or "")

        if st.button("Save DB Config"):
            save_to_env(config)
            config_service.update(config)
            st.success("Database configuration saved!")

    with st.expander("Model Selection"):
        backend_default = config.get("LLM_BACKEND", llm_backend[0])
        backend_index = llm_backend.index(backend_default) if backend_default in llm_backend else 0
        config["LLM_BACKEND"] = st.selectbox("LLM_BACKEND:", llm_backend, index=backend_index)

        selected_backend = config["LLM_BACKEND"]
        filtered_model_options = supported_models.get(selected_backend, [])
        if filtered_model_options:
            model_default = config.get("MODEL", filtered_model_options[0])
            model_index = (
                filtered_model_options.index(model_default)
                if model_default in filtered_model_options
                else 0
            )
        else:
            model_index = 0
        config["MODEL"] = st.selectbox(
            "SELECT Model:",
            filtered_model_options or [""],
            index=model_index,
        )

        config["LLM_API_KEY"] = st.text_input(
            "API KEY:",
            value=config.get("LLM_API_KEY", "") or "",
        )
        config["LLM_ENDPOINT"] = st.text_input(
            "LLM_ENDPOINT:",
            value=config.get("LLM_ENDPOINT", "") or "",
        )
        st.slider("Total Token", 1024, 2048, 4096, key="token_size")

        if st.button("Save LLM Config"):
            save_to_env(config)
            config_service.update(config)
            st.success("LLM configuration saved!")

    with st.expander("Show Database Schema"):
        try:
            schema_tool = st.session_state["tool_registry"].get("sql")
            schema_info = schema_tool.get_schema(config_service.get_config())
            st.text(schema_info)
        except Exception as exc:
            st.error(f"Unable to load schema: {exc}")

config_service.update(config)

nl_query = st.text_area("Ask a question about your data:")
execute_pressed = st.button("▶️  Execute")

if execute_pressed:
    if nl_query.strip():
        status_placeholder = st.empty()
        sql_placeholder = st.empty()
        meta_placeholder = st.empty()
        result_placeholder = st.empty()
        history_saved = False

        for event in runtime_client.stream_query(nl_query):
            if event.type == OrchestratorEventType.STATUS:
                status_placeholder.info(event.payload)
            elif event.type == OrchestratorEventType.SQL:
                backend = config.get("LLM_BACKEND") or config.get("LLM")
                model_name = config.get("MODEL")
                meta_placeholder.text(
                    f"Generated SQL Query: LLM backend {backend} serving {model_name}"
                )
                sql_placeholder.code(event.payload, language="sql")
                if not history_saved:
                    st.session_state.query_history.append((nl_query, event.payload))
                    save_query_history(st.session_state["query_history"])
                    history_saved = True
            elif event.type == OrchestratorEventType.RESULT:
                status_placeholder.success("Query executed successfully!")
                result = event.payload
                if isinstance(result, pd.DataFrame) and not result.empty:
                    st.subheader("Query Results")
                    result_placeholder.dataframe(result)
                else:
                    result_placeholder.write(result)
            elif event.type == OrchestratorEventType.ERROR:
                status_placeholder.error(event.payload)
                break
    else:
        st.warning("Please enter a natural language query.")


display_query_history()

import streamlit as st
import pandas as pd
from db.key_storage import KeyStorage
from db.sql_alchemy import SqlAlchemy
from llm.ollama import nl_to_sql_ollama_docker, nl_to_sql_ollama
import time
import os
from dotenv import load_dotenv

load_dotenv()
# Streamlit App Interface
st.title("DB Copilot: Natural Language to SQL")
st.markdown("### Enter a natural language query to interact with your PostgreSQL database")

sql_alchemy = None

st.markdown(
    """
    <style>
        [data-testid="stSidebar"][aria-expanded="true"] {
            min-width: 250px;
        }
    </style>
    """,
    unsafe_allow_html=True
)



with st.sidebar:
    st.header("⚙️ Config")

    with st.expander("Database Configuration"):

        driver_options = ["postgres","mysql", "mssql","oracle"]
        selected_option = st.selectbox("SELECT DATABASE:", driver_options,index=0)
        db_driver = selected_option

        db_hostname = st.text_input("HOSTNAME:",value="localhost")
        db_user = st.text_input("USER:",value="myuser")
        db_password = st.text_input("PASSWORD:",value="mypassword")
        db_name = st.text_input("NAME:",value="mydatabase")
        db_port = st.text_input("PORT:",value="5432")
        db_uri = st.text_input("URI:",value=None)


        if db_hostname and db_user and db_password and db_name and db_port and db_driver:
            KeyStorage.set_key("DB_HOST",db_hostname)
            KeyStorage.set_key("DB_USER",db_user)
            KeyStorage.set_key("DB_PASSWORD",db_password)
            KeyStorage.set_key("DB_NAME",db_name)
            KeyStorage.set_key("DB_PORT",db_port)
            KeyStorage.set_key("DB_DRIVER",db_driver)
            KeyStorage.set_key("DB_URI",db_uri)
            sql_alchemy = SqlAlchemy(KeyStorage)

    
    with st.expander("LLM Configuration"):
        llm_options = ["ollama","openai", "groq","anthropic","other"]
        selected_llm_option = st.selectbox("SELECT LLM:", llm_options,index=0)
        llm_driver = selected_llm_option

        llm_local_mode_options = ["True","False"]
        llm_local_mode = st.selectbox("LLM LOCAL MODE:",llm_local_mode_options,index=0)
        llm_uri = st.text_input("LLM URI:",value=None)


        KeyStorage.set_key("LLM_MODE",llm_local_mode)


        if llm_local_mode == "False":
            llm_uri = "http://localhost:11434"
            KeyStorage.set_key("LLM_URI",llm_uri)
        else:
            llm_uri = os.getenv("LLM_URI")
            KeyStorage.set_key("LLM_URI",llm_uri)


        # if os.getenv("LLM_URL"):
        #     llm_uri = os.getenv("LLM_URL")
        #     KeyStorage.set_key("LLM_URI",llm_uri)

        # if os.getenv("LLM_URL") is None:

        llm_api_key = st.text_input("API KEY:",value=None)

        if llm_uri:
            KeyStorage.set_key("LLM_DRIVER",llm_driver)
            KeyStorage.set_key("LLM_API_KEY",llm_api_key)



if db_hostname and db_user and db_password and db_name and db_port and db_driver and sql_alchemy:
    with st.expander("Show Database Schema"):
        schema_info = sql_alchemy.get_db_schema()
        st.text(schema_info)


natural_language_query = st.text_area("Your query in plain English:")


if st.button("Generate SQL and Run"):
    if natural_language_query:
        with st.spinner(f"Generating SQL Query using {llm_driver}"):
            if llm_driver == "ollama":
                if KeyStorage.get_key("LLM_MODE") == "False":
                    sql_query = nl_to_sql_ollama_docker(natural_language_query, schema_info, KeyStorage)
                else:
                    sql_query = nl_to_sql_ollama(natural_language_query, schema_info, KeyStorage)

            st.subheader("Generated SQL Query")
            st.code(sql_query, language="sql")

        with st.spinner(f"Executing SQL on {db_driver}"):
            query_result = sql_alchemy.run_query(sql_query)
            if isinstance(query_result, str):
                st.error(f"Error: {query_result}")
            else:
                st.success("Query executed successfully!")
                if isinstance(query_result, pd.DataFrame) and not query_result.empty:
                    st.subheader("Query Results")
                    st.dataframe(query_result)

                    # Chart type dropdown
                    chart_type = st.selectbox("Select chart type to visualize results", ["None", "Line Chart", "Bar Chart", "Area Chart", "Pie Chart"])

                    # Display the selected chart
                    if chart_type == "Line Chart":
                        st.line_chart(query_result)
                    elif chart_type == "Bar Chart":
                        st.bar_chart(query_result)
                    elif chart_type == "Area Chart":
                        st.area_chart(query_result)
                    elif chart_type == "Pie Chart":
                        # For pie chart, we need to select only one categorical and one numerical column
                        if len(query_result.columns) >= 2:
                            x_column = st.selectbox("Select a categorical column for the Pie Chart:", query_result.columns)
                            y_column = st.selectbox("Select a numerical column for the Pie Chart:", query_result.columns)
                            if pd.api.types.is_numeric_dtype(query_result[y_column]):
                                pie_chart_data = query_result.groupby(x_column)[y_column].sum().reset_index()
                                st.write(pie_chart_data.set_index(x_column).plot.pie(y=y_column, autopct="%1.1f%%", legend=False))
                            else:
                                st.warning(f"Column '{y_column}' is not numeric. Select a different column for the pie chart.")
                        else:
                            st.warning("Pie chart requires at least one categorical and one numerical column.")
                else:
                    st.write("No results returned by the query.")
    else:
        st.warning("Please enter a natural language query.")
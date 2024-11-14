import streamlit as st
import pandas as pd
from connectors.sql_alchemy import SqlAlchemy
from llm.huggingface_text_gen import HuggingFaceTextGen
from config.config import ConfigStore 
import time
import os
from dotenv import load_dotenv



load_dotenv()
ConfigStore.load_from_env()

# Streamlit App Interface
st.title("DataPilot: Your AI Copilot for Data Analytics")
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
        ConfigStore.set_key("DB_DRIVER", db_driver)
        ConfigStore.set_key("DB_HOST", st.text_input("DB_HOST:", value=ConfigStore.get_key("DB_HOST", "")))
        ConfigStore.set_key("DB_USER", st.text_input("USER:", value=ConfigStore.get_key("DB_USER", "")))
        ConfigStore.set_key("DB_PASSWORD", st.text_input("PASSWORD:", value=ConfigStore.get_key("DB_PASSWORD", "")))
        ConfigStore.set_key("DB_NAME", st.text_input("NAME:", value=ConfigStore.get_key("DB_NAME", "")))
        ConfigStore.set_key("DB_PORT", st.text_input("PORT:", value=ConfigStore.get_key("DB_PORT", "")))
        ConfigStore.save_to_env()
        sql_alchemy = SqlAlchemy(ConfigStore)

    
    with st.expander("Model Selection"):
        model_options = ["defog/llama-3-sqlcoder-8b",
                         "defog/sqlcoder-70b-alpha",
                         "google/codegemma-7b-it"]
        selected_model_options = st.selectbox("SELECT LLM:", model_options,index=0)
        model_name = selected_model_options
        ConfigStore.set_key("LLM",model_name)
        ConfigStore.set_key("LLM_ENDPOINT", st.text_input("LLM_ENDPOINT:", value=ConfigStore.get_key("LLM_ENDPOINT", "")))
        ConfigStore.save_to_env()
        model_api_key = st.text_input("API KEY:",value=None)

   


with st.expander("Show Database Schema"):
    schema_info = sql_alchemy.get_db_schema()
    st.text(schema_info)


natural_language_query = st.text_area("Your query in plain English:")


if st.button("Generate SQL and Run"):
    if natural_language_query:
       

        with st.spinner(f"Generating SQL Query using {model_name}"):
            inference_client = HuggingFaceTextGen(
            server_url=f"http://{ConfigStore.get_key('LLM_ENDPOINT', '')}/v1/chat/completions",
            model_name=model_name
        )
        print(model_name,ConfigStore.get_key("LLM_ENDPOINT", ""))
        sql_query=inference_client.generate_sql(natural_language_query,schema_info)

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

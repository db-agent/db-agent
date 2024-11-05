import streamlit as st
import pandas as pd
from db.key_storage import KeyStorage
from db.sql_alchemy import SqlAlchemy
from llm.ollama import nl_to_sql


# Streamlit App Interface
st.title("DB Copilot: Natural Language to SQL")
st.markdown("### Enter a natural language query to interact with your PostgreSQL database")

sql_alchemy = None

with st.expander("Enter Database Configuration"):

    db_hostname = st.text_input("Please enter your DB_HOSTNAME:",value="localhost")
    db_user = st.text_input("Please enter your DB_USER:",value="myuser")
    db_password = st.text_input("Please enter your DB_PASSWORD:",value="mypassword")
    db_name = st.text_input("Please enter your DB_NAME:",value="mydatabase")
    db_port = st.text_input("Please enter your DB_PORT:",value="5432")

    # db_hostname = "localhost"
    # db_user = "myuser"
    # db_password = "mypassword"
    # db_name ="mydatabase"
    # db_port = "5432"

    driver_options = ["postgres","mysql", "mssql","oracle"]
    selected_option = st.selectbox("Select DB Hostname:", driver_options)
    db_driver = selected_option

    llm_uri = st.text_input("Please enter your DB_PORT:",value="http://localhost:11434")

    if db_hostname and db_user and db_password and db_name and db_port and db_driver:
        KeyStorage.set_key("DB_HOST",db_hostname)
        KeyStorage.set_key("DB_USER",db_user)
        KeyStorage.set_key("DB_PASSWORD",db_password)
        KeyStorage.set_key("DB_NAME",db_name)
        KeyStorage.set_key("DB_PORT",db_port)
        KeyStorage.set_key("DB_DRIVER",db_driver)
        KeyStorage.set_key("OLLAMA_SERVER_URL",llm_uri)
        sql_alchemy = SqlAlchemy(KeyStorage)


if db_hostname and db_user and db_password and db_name and db_port and db_driver and sql_alchemy:
    with st.expander("Show Database Schema"):
        schema_info = sql_alchemy.get_db_schema()
        st.text(schema_info)


natural_language_query = st.text_area("Your query in plain English:")


if st.button("Generate SQL and Run"):
    if natural_language_query:
        with st.spinner("Generating SQL using LLaMA 3.2..."):
            sql_query = nl_to_sql(natural_language_query, schema_info, KeyStorage)
            st.subheader("Generated SQL Query")
            st.code(sql_query, language="sql")

        with st.spinner("Executing SQL on PostgreSQL..."):
            query_result = sql_alchemy.run_query(sql_query)
            if isinstance(query_result, str):
                st.error(f"Error: {query_result}")
            else:
                st.success("Query executed successfully!")
                if isinstance(query_result, pd.DataFrame) and not query_result.empty:
                    st.subheader("Query Results")
                    st.dataframe(query_result)

                    # Chart type dropdown
                    # chart_type = st.selectbox("Select chart type to visualize results", ["None", "Line Chart", "Bar Chart", "Area Chart", "Pie Chart"])

                    # # Display the selected chart
                    # if chart_type == "Line Chart":
                    #     st.line_chart(query_result)
                    # elif chart_type == "Bar Chart":
                    #     st.bar_chart(query_result)
                    # elif chart_type == "Area Chart":
                    #     st.area_chart(query_result)
                    # elif chart_type == "Pie Chart":
                    #     # For pie chart, we need to select only one categorical and one numerical column
                    #     if len(query_result.columns) >= 2:
                    #         x_column = st.selectbox("Select a categorical column for the Pie Chart:", query_result.columns)
                    #         y_column = st.selectbox("Select a numerical column for the Pie Chart:", query_result.columns)
                    #         if pd.api.types.is_numeric_dtype(query_result[y_column]):
                    #             pie_chart_data = query_result.groupby(x_column)[y_column].sum().reset_index()
                    #             st.write(pie_chart_data.set_index(x_column).plot.pie(y=y_column, autopct="%1.1f%%", legend=False))
                    #         else:
                    #             st.warning(f"Column '{y_column}' is not numeric. Select a different column for the pie chart.")
                    #     else:
                    #         st.warning("Pie chart requires at least one categorical and one numerical column.")
                else:
                    st.write("No results returned by the query.")
    else:
        st.warning("Please enter a natural language query.")
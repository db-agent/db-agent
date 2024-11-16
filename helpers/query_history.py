import os, json
import streamlit as st

PERSISTENCE_FILE = "query_history.json"

# Function to load query history from file
def load_query_history():
    if os.path.exists(PERSISTENCE_FILE):
        with open(PERSISTENCE_FILE, "r") as file:
            return json.load(file)
    return []

# Function to save query history to file
def save_query_history(history):
    with open(PERSISTENCE_FILE, "w") as file:
        json.dump(history, file)

def display_query_history():
    st.write("### Query History")
    for i, (nl_query, sql_query) in enumerate(reversed(st.session_state["query_history"]), 1):
        with st.container():
            st.write(f"**Query History:**")
            st.markdown(f"**Description:** {nl_query}")
            st.markdown("**Generated SQL:**")
            st.code(sql_query, language="sql")


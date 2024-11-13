import streamlit as st
import pandas as pd
import requests
from pandasai import PandasAI

# Hugging Face TGI server details
tgi_server_url = "http://localhost:8000"  # Replace with your TGI server URL
model_name = "bigscience/bloom"  # Replace with the model hosted on your TGI server

# Define a custom Hugging Face TGI Agent for PandasAI
class TGIHuggingFaceAgent:
    def __call__(self, instruction):
        """Function to call Hugging Face TGI model for PandasAI."""
        response = requests.post(
            f"{tgi_server_url}/generate",
            json={
                "inputs": instruction,
                "parameters": {
                    "max_new_tokens": 200,
                    "return_full_text": False
                }
            },
            headers={"Content-Type": "application/json"}
        )
        response.raise_for_status()
        return response.json()["generated_text"]

# Set up Streamlit page
st.set_page_config(page_title="Data Analysis Chatbot", page_icon="🤖", layout="wide")

st.title("Data Analysis Chatbot with PandasAI and Hugging Face TGI")

# Load CSV file
uploaded_file = st.file_uploader("Upload a CSV file", type="csv")

if uploaded_file is not None:
    df = pd.read_csv(uploaded_file)
    st.write("Data Preview:")
    st.write(df.head())

    # Initialize PandasAI with the custom Hugging Face TGI agent
    tgi_agent = TGIHuggingFaceAgent()
    pandas_ai = PandasAI(tgi_agent)

    # User input for natural language query
    query = st.text_area("Ask a question about your data (e.g., 'Show a bar chart of sales by category'):")

    # Run query and display results
    if st.button("Run Query"):
        if query:
            with st.spinner("Processing your query..."):
                try:
                    # Execute the query with PandasAI
                    result = pandas_ai(df, query)
                    st.write("Result:")
                    st.write(result)
                except Exception as e:
                    st.error(f"Error processing query: {e}")
else:
    st.info("Please upload a CSV file to begin.")

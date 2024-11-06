import requests
import re

# Function to convert natural language to SQL using Ollama LLaMA 3.2
def nl_to_sql_ollama(natural_language_query, schema_info, KeyStorage, max_retry=3):
    OLLAMA_SERVER_URL = KeyStorage.get_key("LLM_URI")
    # prompt = f"Given the following database schema:\n\n{schema_info}\n\n Create sql query for this question {natural_language_query}\n\nonly return the sql query dont return and description of explaination"
    prompt = f"""You are a SQL query generator. Your task is to create a SQL query based on a given database schema and a natural language question. Follow these steps carefully:
    1. First, you will be presented with a database schema:
    <schema>
    {schema_info}
    </schema>

    2. Then, you will be given a natural language query:
    <query>
    {natural_language_query}
    </query>

    3. Analyze the schema and the query:
    - Identify the relevant tables and columns from the schema that are needed to answer the query.
    - Determine the necessary SQL operations (SELECT, JOIN, WHERE, GROUP BY, etc.) based on the query requirements.
    - Ensure that your query accurately addresses the natural language question.

    4. Output the SQL query:
    - Do not include any explanations or descriptions.
    - Use proper SQL syntax and formatting for readability.
    - Enclose your SQL query within <sql_query> tags.

    Remember, your task is to generate only the SQL query. Do not provide any additional text, explanations, or descriptions outside of the <sql_query> tags."""

    payload = {
        "model": "llama3.2:1b",
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": 0.4,
        },
    }
    retries = 0
    while retries < max_retry:
        try:
            response = requests.post(f"{OLLAMA_SERVER_URL}/api/generate", json=payload)
            response.raise_for_status()
            result = response.json()
            sql_query = result["response"].strip()
            query_match = re.search(r'<sql_query>(.*?)</sql_query>', sql_query, re.DOTALL)
            sql_query_stripped = query_match.group(1).strip()
            return sql_query_stripped
        except Exception as e:
            retries += 1
            if retries == max_retry:
                print("max retries reached")
                break
            else:
                print(f"Error communicating with Ollama: {str(e)}")
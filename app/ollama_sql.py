import requests
import os
import json  # Import the standard JSON library

# Configuration for an unsecured Ollama server
OLLAMA_API_URL = "http://<>:11434/api/chat"  # Replace with your actual server URL
API_TOKEN = os.getenv("OLLAMA_API_TOKEN")  # Assuming an API token is still needed; remove if not required

def generate_sql_query(input_text, schema_description):
    prompt = f"""
    Given the following SQL schema:
    {schema_description}
    
    Convert the following natural language request into a SQL query:
    "{input_text}"
    
    SQL Query:
    """

    headers = {
        "Content-Type": "application/json"
    }
    
    # If your server doesn't require an API token, you can skip the Authorization header
    if API_TOKEN:
        headers["Authorization"] = f"Bearer {API_TOKEN}"
    
    data = {
        "model": "llama3.1",  # Specify the model you're using
        "messages": [{"role": "user", "content": prompt}]
    }

    response = requests.post(OLLAMA_API_URL, headers=headers, json=data, stream=True)

    # Collecting the content from the streaming response
    sql_query = ""
    for line in response.iter_lines():
        if line:
            try:
                message = json.loads(line.decode('utf-8'))  # Use the standard json library
                sql_query += message['message']['content']
            except ValueError:
                # Handle the case where the line isn't valid JSON
                print("Failed to parse line:", line.decode('utf-8'))

    return sql_query.strip()

# Define the SQL schema as a string
schema_description = """
CREATE TABLE employees (
    id INT PRIMARY KEY,
    name VARCHAR(100),
    age INT,
    department VARCHAR(50),
    salary DECIMAL(10, 2)
);
"""

# Example usage
if __name__ == "__main__":
    user_input = "Get the names of employees in the 'HR' department earning more than 50000."
    
    sql_query = generate_sql_query(user_input, schema_description)
    
    print("Generated SQL Query:")
    print(sql_query)

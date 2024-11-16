import requests
from dotenv import load_dotenv
import re

load_dotenv()


class HuggingFaceTextGen:
    def __init__(self, server_url, model_name):
        """
        Initialize the inference server client with a custom server URL and model name.
        
        :param server_url: The URL of the server hosting the model (e.g., "http://localhost:8000/v1/chat/completions")
        :param model_name: The name or ID of the model to use (e.g., "defog/llama-3-sqlcoder-8b")
        """
        self.server_url = server_url
        self.model_name = model_name

    def generate_sql(self, user_question, db_schema):
        """
        Sends a request to the inference server to generate a response based on the prompt.
        
        :param prompt: The input text prompt to generate a response.
        :return: The generated response from the model.
        """
        prompt = (
            "<|begin_of_text|><|start_header_id|>user<|end_header_id|>\n\n"
            f"Generate a SQL query only to answer this question without explaination: `{user_question}`\n"
            "DDL statements:\n"
            f"{db_schema}<|eot_id|><|start_header_id|>assistant<|end_header_id|>\n\n"
        )

        headers = {"Content-Type": "application/json"}
        data = {
            "model": self.model_name,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0
  
        }

        try:
            response = requests.post(self.server_url, headers=headers, json=data)
            print("******", response)
            response.raise_for_status()  # Check if the request was successful
            llm_respose = self.extract_sql_statement(response.json().get("choices", [{}])[0].get("message", {}).get("content", "No response"))
            print("llm_response", llm_respose)
            return self.extract_sql_statement(llm_respose)
            # return response.json().get("choices", [{}])[0].get("message", {}).get("content", "No response")
        except requests.exceptions.RequestException as e:
            return f"Error: {e}"
    def extract_sql_statement(self,input_string):
        """
        Extracts the SQL statement from a given string.

        Args:
            input_string (str): The string containing the SQL statement.

        Returns:
            str: The extracted SQL statement, or None if no statement is found.
        """
        sql_pattern = re.compile(
            r"(?i)\bSELECT\b.*?\bFROM\b.*?(?:;|$)",  # Matches SQL statements starting with SELECT and containing FROM
            re.DOTALL  # Enables matching across multiple lines
        )
        print("Output from LLM", input_string)
        match = sql_pattern.search(input_string)
        return match.group(0).strip() if match else None



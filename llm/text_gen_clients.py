import requests
import re
from abc import ABC, abstractmethod

class TextGenBase(ABC):
    """
    Abstract base class for text generation clients.
    """
    def __init__(self, server_url, model_name):
        """
        Initialize the client with server URL and model name.
        """
        self.server_url = server_url
        self.model_name = model_name

    @abstractmethod
    def construct_payload(self, user_question, db_schema):
        """
        Construct the request payload for the specific provider.
        """
        pass

    @abstractmethod
    def parse_response(self, response):
        """
        Parse the response for the specific provider.
        """
        pass

    def generate_sql(self, user_question, db_schema):
        """
        Generates a SQL query using the specific provider's implementation.
        """
        try:
            payload = self.construct_payload(user_question, db_schema)
            headers = {"Content-Type": "application/json"}
            response = requests.post(self.server_url, headers=headers, json=payload)
            response.raise_for_status()
            raw_response = response.json()
            return self._extract_sql_statement(self.parse_response(raw_response))
        except requests.exceptions.RequestException as e:
            return f"Error: {e}"

    @staticmethod
    def _extract_sql_statement(input_string):
        """
        Extract the SQL statement from a given string.
        """
        sql_pattern = re.compile(
            r"(?i)\bSELECT\b.*?\bFROM\b.*?(?:;|$)",  # Matches SQL statements starting with SELECT and containing FROM
            re.DOTALL  # Enables matching across multiple lines
        )
        print("==extract_sql_statement== Output from LLM:", input_string)
        match = sql_pattern.search(input_string)
        return match.group(0).strip() if match else None


class HuggingFaceClient(TextGenBase):
    """
    HuggingFace TGI client implementation.
    """
    def construct_payload(self, user_question, db_schema):
        prompt = (
            "<|begin_of_text|><|start_header_id|>user<|end_header_id|>\n\n"
            f"Generate a SQL query only to answer this question without explanation: `{user_question}`\n"
            "DDL statements:\n"
            f"{db_schema}<|eot_id|><|start_header_id|>assistant<|end_header_id|>\n\n"
        )
        return {
            "model": self.model_name,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0
        }

    def parse_response(self, response):
        return response.get("choices", [{}])[0].get("message", {}).get("content", "No response")


class OllamaClient(TextGenBase):
    """
    Ollama client implementation.
    """
    def construct_payload(self, user_question, db_schema):
        prompt = (
            f"Generate a SQL query to answer this question without explanation: `{user_question}`\n"
            f"DDL statements:\n{db_schema}"
        )
        return {
            "model": self.model_name,
            "prompt": prompt
        }

    def parse_response(self, response):
        return response.get("response", "No response")


# Example Usage
if __name__ == "__main__":
    # HuggingFace example
    hf_client = HuggingFaceClient("http://localhost:8000/v1/chat/completions", "defog/llama-3-sqlcoder-8b")
    hf_response = hf_client.generate_sql("What are the top 10 products?", "CREATE TABLE products (id INT, name TEXT);")
    print("HuggingFace Response:", hf_response)

    # Ollama example
    ollama_client = OllamaClient("http://localhost:11434/api/chat", "hf.co/defog/sqlcoder-7b-2")
    ollama_response = ollama_client.generate_sql("What are the top 10 products?", "CREATE TABLE products (id INT, name TEXT);")
    print("Ollama Response:", ollama_response)

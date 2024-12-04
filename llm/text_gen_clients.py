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

        self.server_url = self.override_server_url(server_url)
        self.model_name = model_name

    def override_server_url(self, server_url):
        """
        Override server URL in subclasses if necessary.
        By default, it returns the provided server_url unchanged.
        """
        return server_url

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
            print("Trying LLM backend",user_question,self.server_url,payload)
            headers = {"Content-Type": "application/json"}
            response = requests.post(self.server_url, headers=headers, json=payload)
            raw_response = response.json()
            # response.raise_for_status()
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
        match = sql_pattern.search(input_string)
        return match.group(0).strip() if match else None


class HuggingFaceClient(TextGenBase):
    """
    HuggingFace TGI client implementation.
    """

    def override_server_url(self, server_url):
        """
        Override the server URL for HuggingFace if necessary.
        """
        print("HuggingFace-specific override for server_url")
        return f"http://{server_url}/v1/chat/completions"

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
    def override_server_url(self, server_url):
        """
        Override the server URL for Ollama if necessary.
        """
        print("Ollama-specific override for server_url")
        return f"http://{server_url}/api/chat"
    
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
            "stream": False,
            "temperature": 0

        }

    def parse_response(self, response):
        print("*********Raw Response*****\n",response)
        return response.get('message', {}).get('content', '').strip()


class LLMClientFactory:
    """
    Factory class to create LLM clients based on the specified backend.
    """

    @staticmethod
    def get_client(backend, server_url, model_name):
        """
        Factory method to instantiate the appropriate client.

        Args:
            backend (str): The LLM backend (e.g., 'huggingface', 'ollama').
            server_url (str): The server URL.
            model_name (str): The model name.

        Returns:
            TextGenBase: An instance of the appropriate client class.

        Raises:
            ValueError: If the backend is not recognized.
        """
        backend = backend.lower()
        if backend == "huggingface-tgi":
            return HuggingFaceClient(server_url, model_name)
        elif backend == "ollama":
            return OllamaClient(server_url, model_name)
        else:
            raise ValueError(f"Unsupported LLM backend: {backend}")

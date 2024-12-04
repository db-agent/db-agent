import re
import requests
import logging
from abc import ABC, abstractmethod

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class TextGenBase(ABC):
    """
    Abstract base class for text generation clients.
    """

    def __init__(self, server_url, model_name):
        self.server_url = self.override_server_url(server_url)
        self.model_name = model_name
        logger.info(f"Initialized {self.__class__.__name__} with server_url={self.server_url} and model_name={self.model_name}")

    def override_server_url(self, server_url):
        """
        Override server URL in subclasses if necessary.
        """
        return server_url

    @abstractmethod
    def construct_payload(self, user_question, db_schema):
        pass

    @abstractmethod
    def parse_response(self, response):
        pass

    def generate_sql(self, user_question, db_schema):
        try:
            payload = self.construct_payload(user_question, db_schema)
            headers = {"Content-Type": "application/json"}
            response = requests.post(self.server_url, headers=headers, json=payload)
            response.raise_for_status()
            raw_response = response.json()
            return self._extract_sql_statement(self.parse_response(raw_response))
        except requests.exceptions.RequestException as e:
            error_response = None
            if hasattr(e.response, "text"):  # Check if the response object exists
                error_response = e.response.text
            error_message = f"Error: {e}.\n Response: {error_response}"
            logging.error(error_message)  # Log the error for debugging purposes
            return error_message

    @staticmethod
    def _extract_sql_statement(input_string):
        sql_pattern = re.compile(
            r"(?i)\bSELECT\b.*?\bFROM\b.*?(?:;|$)",  # Matches SQL statements starting with SELECT and containing FROM
            re.DOTALL
        )
        match = sql_pattern.search(input_string)
        return match.group(0).strip() if match else None

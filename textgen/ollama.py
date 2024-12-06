from .base import TextGenBase
import logging

logger = logging.getLogger(__name__)

class OllamaClient(TextGenBase):
    def override_server_url(self, server_url):
        logger.info("Overriding server URL for Ollama")
        return f"http://{server_url}/api/chat"

    def construct_sql_payload(self, user_question, db_schema):
        logger.info("Constructing payload for Ollama")
        prompt = (
            "<|begin_of_text|><|start_header_id|>user<|end_header_id|>\n\n"
            f"Generate a SQL query only to answer this question without explanation: `{user_question}`\n"
            "DDL statements:\n"
            f"{db_schema}<|start_header_id|>assistant<|end_header_id|>\n\n"
        )
        return {
            "model": self.model_name,
            "messages": [{"role": "user", "content": prompt}],
            "stream": False,
            "temperature": 0
        }

    def parse_response(self, response):
        logger.info(f"Parsing response for Ollama {response}")
        return response.get('message', {}).get('content', '').strip()

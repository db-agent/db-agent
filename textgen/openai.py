from openai import OpenAI
from .base import TextGenBase
import logging

logger = logging.getLogger(__name__)


class OpenAIClient:
    def override_server_url(self, server_url):
        logger.info("Overriding server URL for HuggingFace")
        server_url= f"http://{server_url}/v1/"
        self.client = OpenAI(
            base_url=server_url,
            api_key="-"
        )
        return server_url

    def construct_sql_payload(self, user_question, db_schema):
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
    
    def construct_generic_payload(self, user_question):
        chat_completion = self.client.chat.completions.create(
            model="meta-llama/Llama-3.2-1B-Instruct",
            messages=[
                {"role": "user", "content": user_question}
            ],
            stream=False,
            max_tokens=1024,  # Maximum number of tokens to generate
            temperature=0.7,  # Adds randomness to encourage a longer response
            top_p=0.9         # Ensures diverse token sampling
        )

    def parse_response(self, response):
        logger.info(f"Parsing response of {self.model_name} with TGI")
        return response.get("choices", [{}])[0].get("message", {}).get("content", "No response")

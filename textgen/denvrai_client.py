from openai import OpenAI
from .base import TextGenBase
import logging
import os

logger = logging.getLogger(__name__)


class DenvrAIClient(TextGenBase):
    def override_server_url(self, server_url):
        logger.info("Overriding server URL for HuggingFace")
        print(f"====> {server_url}")
        server_url= server_url
        api_key=os.environ.get('API_KEY')
        self.client = OpenAI(
            base_url=server_url,
            api_key=api_key
        )
        models = self.client.models.list()
        print(models)
        self.model_name = models.data[0].id
        return server_url

    def construct_sql_payload(self, user_question, db_schema):
        prompt = (
            "<|begin_of_text|><|start_header_id|>user<|end_header_id|>\n\n"
            f"Generate a SQL query only to answer this question without explanation: `{user_question}`\n"
            "DDL statements:\n"
            f"{db_schema}<|eot_id|><|start_header_id|>assistant<|end_header_id|>\n\n"
        )
        prompt = \
            f"Generate a SQL query only to answer this question without explanation and without code formatting for markdown: `{user_question}`\n"\
            f"DDL statements:\n"\
            f"{db_schema}\n"
        return prompt
    
    def construct_generic_payload(self, user_question):
        chat_completion = self.client.chat.completions.create(
            model="codellama/CodeLlama-34b-Instruct-hf",
            messages=[
                {"role": "user", "content": user_question}
            ],
            stream=False,
            max_tokens=1024,  # Maximum number of tokens to generate
            temperature=0.7,  # Adds randomness to encourage a longer response
            top_p=0.9         # Ensures diverse token sampling
        )

    def generate_sql(self, user_question, db_schema):
        
        chat_completion = self.client.chat.completions.create(
            model=self.client.models.list().data[0].id,
            messages=[
                {"role": "user", "content": self.construct_sql_payload(user_question,db_schema)}
            ],
            stream=False,
            max_tokens=1024,  # Maximum number of tokens to generate
            temperature=0.7,  # Adds randomness to encourage a longer response
            top_p=0.9         # Ensures diverse token sampling
        )
        
        return self.parse_response(chat_completion)
    
    def generate_generic_response(self, user_question):
        pass
    def parse_response(self, response):
        if response and hasattr(response, "choices") and response.choices:
            return response.choices[0].message.content
        return "No response"

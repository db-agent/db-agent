from .base import TextGenBase
import logging
import google.generativeai as genai

logger = logging.getLogger(__name__)

class GoogleGeminiClient(TextGenBase):

    def construct_sql_payload(self, user_question, db_schema):
        prompt = \
            f"Generate a SQL query only to answer this question without explanation and without code formatting for markdown: `{user_question}`\n"\
            f"DDL statements:\n"\
            f"{db_schema}\n"
        
        return prompt
    
    def construct_generic_payload(self, user_question):
        return user_question

    def generate_sql(self, user_question, db_schema):
        genai.configure(api_key=self.api_key)
        model = genai.GenerativeModel(self.model_name)
        response = model.generate_content(self.construct_sql_payload(user_question,db_schema))
        return self.parse_response(response)
    
    def generate_generic_response(self, user_question):
        genai.configure(api_key=self.api_key)
        model = genai.GenerativeModel(self.model_name)
        response = model.generate_content(user_question)
        return self.parse_response(response)
                

    def parse_response(self, response):
        logger.info(f"Parsing response of {self.model_name} with Google Gemini")
        return response.text
        
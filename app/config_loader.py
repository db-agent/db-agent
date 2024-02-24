from dotenv import load_dotenv
import os

class ConfigLoader:
    def __init__(self):
        load_dotenv()

    @property
    def openai_api_key(self):
        return os.getenv("OPENAI_API_KEY")

    @property
    def db_config(self):
        return {
            'host': os.getenv("DB_HOST"),
            'user': os.getenv("DB_USER"),
            'password': os.getenv("DB_PASSWORD"),
            'database': os.getenv("DB_NAME")
        }

from dotenv import load_dotenv
import os
import streamlit as st
from pathlib import Path


def save_to_env(config):
    env_file = Path(".env")
    with env_file.open("w") as f:
        for key, value in config.items():
            f.write(f"{key}={value}\n")
    

def load_from_env():
    env_file = Path(".env")
    if env_file.exists():
        load_dotenv(env_file,override=True)
        return {
            "DB_DRIVER": os.getenv("DB_DRIVER",'postgres'),
            "DB_HOST": os.getenv("DB_HOST"),
            "DB_USER": os.getenv("DB_USER"),
            "DB_PASSWORD": os.getenv("DB_PASSWORD"),
            "DB_NAME": os.getenv("DB_NAME"),
            "DB_PORT": os.getenv("DB_PORT"),
            "LLM": os.getenv("LLM"),
            "LLM_API_KEY": os.getenv("LLM_API_KEY"),
            "LLM_ENDPOINT": os.getenv("LLM_ENDPOINT")
        }
    


from dotenv import load_dotenv
import os

class ConfigStore:
    keys = {}

    @classmethod
    def set_key(cls, key_name, key_value):
        cls.keys[key_name] = key_value

    @classmethod
    def get_key(cls, key_name, default_value=None):
        return cls.keys.get(key_name, default_value)
    
    @classmethod
    def save_to_env(cls, file_path=".env"):
        """
        Save all key-value pairs to a .env file.

        Args:
            file_path (str): Path to the .env file (default: ".env").
        """
        with open(file_path, "w") as env_file:
            for key, value in cls.keys.items():
                # Ensure keys and values are properly formatted for .env files
                formatted_value = str(value).replace("\n", "\\n")  # Escape newlines
                env_file.write(f"{key}={formatted_value}\n")
    @classmethod
    def load_from_env(cls, file_path=".env"):
        """Load keys from .env file or environment variables."""
        load_dotenv(file_path)  # Load from .env file into environment variables
        for key in os.environ.keys():
            if key.startswith("DB_") or key in ["LLM", "LLM_ENDPOINT"]:
                cls.keys[key] = os.getenv(key)
    @classmethod
    def print_all_keys(cls):
        """Print all key-value pairs in the ConfigStore."""
        print("Current Configuration:")
        for key, value in cls.keys.items():
            print(f"{key}={value}")

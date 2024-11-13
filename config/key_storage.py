import json
import os

class KeyStorage:
    keys = {}
    file_path = 'config/.env.json'  # File to store keys

    @classmethod
    def load_keys(cls):
        """Load keys from file if it exists."""
        if os.path.exists(cls.file_path):
            with open(cls.file_path, 'r') as f:
                cls.keys = json.load(f)

    @classmethod
    def save_keys(cls):
        """Save keys to file."""
        with open(cls.file_path, 'w') as f:
            json.dump(cls.keys, f)

    @classmethod
    def set_key(cls, key_name, key_value):
        cls.keys[key_name] = key_value
        cls.save_keys()  # Save to file after setting key

    @classmethod
    def get_key(cls, key_name):
        return cls.keys.get(key_name)

# Load keys initially when the class is first used
KeyStorage.load_keys()

import os, json

PERSISTENCE_FILE = "query_history.json"

# Function to load query history from file
def load_query_history():
    if os.path.exists(PERSISTENCE_FILE):
        with open(PERSISTENCE_FILE, "r") as file:
            return json.load(file)
    return []

# Function to save query history to file
def save_query_history(history):
    with open(PERSISTENCE_FILE, "w") as file:
        json.dump(history, file)
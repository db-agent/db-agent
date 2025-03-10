# Define supported models for each backend

supported_models = {
    "DenvrAI-Models": ["defog/llama-3-sqlcoder-8b",
            "codellama/CodeLlama-34b-Instruct-hf"],
    "Ollama": ["deepseek-r1:1.5b",
               "llama3.2:1b"],
    "gemini": ["gemini-2.0-flash-exp",
               "gemini-1.5-flash"]
    
}

model_url = {
    "codellama/CodeLlama-34b-Instruct-hf": "https://inference-api.cloud.denvrdata.com/CodeLlama-34b-Instruct/v1/",
    "defog/llama-3-sqlcoder-8b": "http://130.250.171.57:8000/v1",
    "deepseek-r1:1.5b": "http://localhost:11434/v1",
    "llama3.2:1b": "http://localhost:11434/v1"
}

llm_backend = ["DenvrAI-Models","Ollama","gemini"]
    
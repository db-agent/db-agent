# Define supported models for each backend

supported_models = {
    "huggingface": ["meta-llama/Llama-3.2-1B-Instruct",
                    "microsoft/Phi-3.5-mini-instruct",
                    "google/gemma-2-2b-it",
                    "defog/llama-3-sqlcoder-8b",
                    "defog/sqlcoder-70b-alpha",
                    "meta-llama/Llama-3.3-70B-Instruct"],
    "ollama": ["deepseek-r1:7b",
               "llama3.2:1b",
               "llama3.2:latest",
               "llama3.3",
               "hf.co/defog/sqlcoder-7b-2"],
    "vllm": ["microsoft/Phi-3.5-mini-instruct", 
            "google/gemma-2-2b-it",
            "meta-llama/Llama-3.3-70B-Instruct"],
    "gemini": ["gemini-2.0-flash-exp",
               "gemini-1.5-flash"],
    "openai": ["gpt-4o"]
}

llm_backend = [
    "huggingface",
    "ollama",
    "vllm",
    "gemini",
    "openai"
        ]

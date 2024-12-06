from .huggingface import HuggingFaceClient
from .ollama import OllamaClient
from .openai import OpenAIClient

class LLMClientFactory:
    @staticmethod
    def get_client(backend, server_url, model_name):
        backend = backend.lower()
        if backend == "huggingface":
            return HuggingFaceClient(server_url, model_name)
        elif backend == "ollama":
            return OllamaClient(server_url, model_name)
        elif backend == "openai":
            return OpenAIClient(server_url,model_name)
        else:
            raise ValueError(f"Unsupported LLM backend: {backend}")

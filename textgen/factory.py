from .huggingface import HuggingFaceClient
from .ollama import OllamaClient
from .openai_client import OpenAIClient
from .google_gemini import GoogleGeminiClient

class LLMClientFactory:
    @staticmethod
    def get_client(backend, server_url, model_name,api_key):
        backend = backend.lower()
        if backend == "huggingface":
            return HuggingFaceClient(server_url, model_name)
        elif backend == "ollama":
            return OllamaClient(server_url, model_name)
        elif backend == "openai":
            return OpenAIClient(server_url,model_name)
        elif backend == "gemini":
            return GoogleGeminiClient(server_url,model_name,api_key)
        else:
            raise ValueError(f"Unsupported LLM backend: {backend}")

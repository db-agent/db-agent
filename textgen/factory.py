from .huggingface import HuggingFaceClient
from .ollama import OllamaClient
from .denvrai_client import DenvrAIClient
from .google_gemini import GoogleGeminiClient


class LLMClientFactory:
    @staticmethod
    def get_client(backend, server_url, model_name,api_key):
        print(f"Creating client for {backend}, {server_url} with model {model_name}")
        backend = backend.lower()
        if backend == "huggingface":
            return HuggingFaceClient(server_url, model_name)
        # elif backend == "localollama":
        #     return OllamaClient(server_url, model_name)
        elif backend == "denvrai" or backend == "ollama" or backend == "models" or backend == "denvrai-models":
            return DenvrAIClient(server_url, model_name)
        elif backend == "gemini":
            return GoogleGeminiClient(server_url,model_name,api_key)
        
        else:
            raise ValueError(f"Unsupported LLM backend: {backend}")

    
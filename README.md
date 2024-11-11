# Db-Copilot

# Quickstart Guide

This guide walks you through the steps to set up and run your containers using Docker.

## Prerequisites

Before starting, make sure you have the following installed on your system:

- Docker
- Docker Compose


## Quickstart Guide to launch the application with Ollama ( Llama 3.2 )


To start, you need to build your Docker images using `docker-compose`:

```bash
docker compose build
```

```bash
docker compose up
```

## Inference Options

### Local Llama3.2 with Ollama

```
docker run -d --gpus=all -v ollama:/root/.ollama -p 11434:11434 --name ollama ollama/ollama

docker exec -it ollama ollama run llama3.2:1b
```

### Huggingface Models ( TGI )

- defog/llama-3-sqlcoder-8b

```
# Deploy with docker on Linux:
docker run --gpus all \
	-v ~/.cache/huggingface:/root/.cache/huggingface \
 	-e HF_TOKEN="<secret>" \
	-p 8000:80 \
	ghcr.io/huggingface/text-generation-inference:latest \
	--model-id defog/llama-3-sqlcoder-8b
```
- bigscience/bloomz-560m

```
docker run --gpus all \
	-v ~/.cache/huggingface:/root/.cache/huggingface \
 	-e HF_TOKEN="<secret>" \
	-p 8000:80 \
	ghcr.io/huggingface/text-generation-inference:latest \
	--model-id bigscience/bloomz-560m
```

### Embedding 

```
# Use a pipeline as a high-level helper
from transformers import pipeline

messages = [
    {"role": "user", "content": "Who are you?"},
]
pipe = pipeline("text-generation", model="defog/llama-3-sqlcoder-8b")
pipe(messages)
```

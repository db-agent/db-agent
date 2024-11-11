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

### Huggingface Models

- bigscience/bloomz-560m

```
docker run --gpus all \
	-v ~/.cache/huggingface:/root/.cache/huggingface \
 	-e HF_TOKEN="<secret>" \
	-p 8000:80 \
	ghcr.io/huggingface/text-generation-inference:latest \
	--model-id bigscience/bloomz-560m
```

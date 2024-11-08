# dpgpt

DatapilotGPT - A copliot to help you interact with your data using natural language

- You can find the [demo video](https://www.loom.com/share/a8d7f8b56e1349ea99a7417835000e52?sid=75947c3a-e9db-4e7a-afb2-36c4c0150863) for better understanding of one of the usecase.
- Some of the [Example prompts](https://www.datapilotgpt.com/post/introduction-sql-gpt-llm-langchain) and how it can be helpful

# Quickstart Guide

This guide walks you through the steps to set up and run your containers using Docker.

## Prerequisites

Before starting, make sure you have the following installed on your system:

- Docker
- Docker Compose

If you don't have them installed, please follow the official documentation for installation:

- [Install Docker](https://docs.docker.com/get-docker/)
- [Install Docker Compose](https://docs.docker.com/compose/install/)

---

## Docker Guide

Follow these steps to build and run your containers.


To start, you need to build your Docker images using `docker-compose`:

```bash
docker compose build
```

```bash
docker compose up
```


```bash
docker exec -it ollama ollama run llama3.2:1b
```
restart both docker container
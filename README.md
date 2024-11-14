# DataPilot

## Demo Video

[Watch the demo video](https://youtu.be/KT84qySZw1I)


## Quickstart Guide to launch the application with Ollama ( Llama 3.2 )


```bash
docker compose build
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
 	-e HF_TOKEN=$HF_TOKEN \
	-p 8000:80 \
	ghcr.io/huggingface/text-generation-inference:latest \
	--model-id defog/llama-3-sqlcoder-8b
```
- bigscience/bloomz-560m

```
docker run --gpus all \
	-v ~/.cache/huggingface:/root/.cache/huggingface \
 	-e HF_TOKEN=$HF_TOKEN \
	-p 8000:80 \
	ghcr.io/huggingface/text-generation-inference:latest \
	--model-id bigscience/bloomz-560m
```
- meta-llama/Llama-3.2-1B
```
# Deploy with docker on Linux:
docker run --gpus all \
	-v ~/.cache/huggingface:/root/.cache/huggingface \
 	-e HF_TOKEN="<secret>" \
	-p 8000:80 \
	ghcr.io/huggingface/text-generation-inference:latest \
	--model-id meta-llama/Llama-3.2-1B

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

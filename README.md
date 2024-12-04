# db-agent

[![Docker Image CI](https://github.com/db-agent/db-agent/actions/workflows/docker-image.yml/badge.svg)](https://github.com/db-agent/db-agent/actions/workflows/docker-image.yml)
[![Checkout the Website](https://img.shields.io/badge/Visit-Our%20Website-brightgreen)](https://www.db-agent.com)
[![Demo Video](https://img.shields.io/badge/Visit-Our%20Demo-red)](https://youtu.be/tt0oTIrY260)





## Demo Video

[Watch the demo video](https://youtu.be/KT84qySZw1I)



```bash
export HF_TOKEN=<YOUR TOKEN>
docker compose -f docker-compose.demo.yml build
docker compose -f docker-compose.demo.yml up -d
```

## Inference Options ( with GPUs )

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


### Ollama 

- hf.co/defog/sqlcoder-7b-2

```
docker run -d --gpus=all -v ollama:/root/.ollama -p 11434:11434 --name ollama ollama/ollama
docker exec -it ollama ollama run hf.co/defog/sqlcoder-7b-2

```

## Running on Cloud

- Run the application + model on Nvidia A100, H100 on [![Denvr Cloud](https://img.shields.io/badge/Run%20On-Denvr%20Cloud-brightgreen)](https://console.cloud.denvrdata.com/account/login)

## Running the model locally

- MacOS or X86/Nvidia based machines should have enough GPU memory to support the models.
- Below error is from MacBook M2 Pro 32 GB

```
docker exec -it ollama ollama run hf.co/defog/sqlcoder-7b-2
pulling manifest
pulling 0068f25d1fc3... 100% ▕██████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████▏ 4.8 GB
pulling d91e3b3ad4cb... 100% ▕██████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████▏  193 B
verifying sha256 digest
writing manifest
success
Error: model requires more system memory (9.3 GiB) than is available (7.8 GiB)
```




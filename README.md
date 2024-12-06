# db-agent

[![Docker Image CI](https://github.com/db-agent/db-agent/actions/workflows/docker-image.yml/badge.svg)](https://github.com/db-agent/db-agent/actions/workflows/docker-image.yml)
[![Checkout the Website](https://img.shields.io/badge/Visit-Our%20Website-brightgreen)](https://www.db-agent.com)
[![Demo Video](https://img.shields.io/badge/Visit-Our%20Demo-red)](https://youtu.be/tt0oTIrY260)
[![Denvr Cloud](https://img.shields.io/badge/Deploy%20On-Denvr%20Cloud-brightgreen)](https://console.cloud.denvrdata.com/account/login)



## Inference Options ( with GPUs )

### GPU Memory requirements

| Engine | Model                              | Memory | GPU         |
|--------|------------------------------------|--------|-------------|
| TGI    | meta-llama/Llama-3.2-1B-Instruct  | 36GB   | A100-40G    |
| TGI    | meta-llama/Llama-3.2-1B-Instruct  | 72GB   | A100-80G    |


### Huggingface Models ( TGI )

- defog/llama-3-sqlcoder-8b
- meta-llama/Llama-3.2-1B-Instruct
- microsoft/Phi-3.5-mini-instruct
- google/gemma-2-2b-it
- meta-llama/Llama-3.2-1B-Instruct

```
# Deploy with docker on Linux:
docker run --gpus all \
	-v ~/.cache/huggingface:/root/.cache/huggingface \
 	-e HF_TOKEN=$HF_TOKEN \
	-p 8000:80 \
	ghcr.io/huggingface/text-generation-inference:latest \
	--model-id $MODEL
```


### Ollama 

- hf.co/defog/sqlcoder-7b-2

```
docker run -d --gpus=all -v ollama:/root/.ollama -p 11434:11434 --name ollama ollama/ollama
docker exec -it ollama ollama run hf.co/defog/sqlcoder-7b-2

```

## Running on Cloud

- Run the application + model on Nvidia A100, H100

## Running the model locally

- MacOS or X86/Nvidia based machines should have enough GPU memory to support the models.

```bash
export HF_TOKEN=<YOUR TOKEN>
docker compose -f docker-compose.demo.yml build
docker compose -f docker-compose.demo.yml up -d
```






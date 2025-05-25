# db-agent

[![Docker Image CI](https://github.com/db-agent/db-agent/actions/workflows/docker-image.yml/badge.svg)](https://github.com/db-agent/db-agent/actions/workflows/docker-image.yml)
[![Checkout the Website](https://img.shields.io/badge/Visit-Our%20Website-brightgreen)](https://www.db-agent.com)
[![Demo Video](https://img.shields.io/badge/Visit-Our%20Demo-red)](https://youtu.be/tt0oTIrY260)
[![Denvr Cloud](https://img.shields.io/badge/Deploy%20On-Denvr%20Cloud-brightgreen)](https://console.cloud.denvrdata.com/account/login)
[![Live App](https://img.shields.io/badge/Live-App-brightgreen)](https://db-agent.streamlit.app/)

---
Latest News 🔥

- [4 March 2025] - Presented in [AAAI-25 workshop](https://the-ai-alliance.github.io/AAAI-25-Workshop-on-Open-Source-AI-for-Mainstream-Use/program/) at Philadelphia . The workshop paper can be found [here](https://drive.google.com/file/d/1oQ83on04XHN6BZKJjdDu90eWK6RprT8X/view?usp=sharing) 

## Running the model locally with Ollama

- MacOS or X86/Nvidia based machines should have enough GPU memory to support the models.
- Download and Install Ollama and docker
- Pull the Llama3.2:1b model

```
curl http://localhost:11434/api/pull -d '{
  "model": "deepseek-r1"
}'
```

- Validate if Ollama is serving the model

```
curl http://localhost:11434/api/chat -d '{
  "model": "deepseek-r1",
  "messages": [
    {
      "role": "user",
      "content": "why is the sky blue?"
    }
  ],
  "stream": false
}'
```

- Launch the application with Sample database ( PostgreSQL )

```
docker compose -f docker-compose.local.yml build
docker compose -f docker-compose.local.yml up -d
# Check logs
docker compose -f docker-compose.local.yml logs -f

```
- Access the application at `http://localhost:8501`
- Setup DB configuration as below

<img width="493" alt="image" src="https://github.com/user-attachments/assets/490e5469-e299-471b-8c9c-fa0e002f2bb6">

- Setup the Model configuration as below ( ensure LLM_ENDPOINT is your computers IP address )
<img width="480" alt="image" src="https://github.com/user-attachments/assets/d7b6e8c0-85e5-4b17-954a-3b79187d5c95">


## Running on Cloud

- Run the application + model on Nvidia GPUs A100, H100

### Huggingface Models ( TGI )

```bash
export HF_TOKEN=<YOUR TOKEN>
docker compose -f docker-compose.tgi.yml build
docker compose -f docker-compose.tgi.yml up -d
```

### Other supported model
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













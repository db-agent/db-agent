

## Update the Package
```
sudo apt update -y
sudo apt upgrade -y
```

## Install Ollama ( Including nvidia drivers )

```
curl -fsSL https://ollama.com/install.sh | sh
```

## Modify configuration to listen to all ports
```
sudo nano /etc/systemd/system/ollama.service
Environment="OLLAMA_HOST=0.0.0.0:11434" # this line is mandatory. You can also specify
```
## Example

```
[Unit]
Description=Ollama Service
After=network-online.target

[Service]
ExecStart=/usr/local/bin/ollama serve
Environment="OLLAMA_HOST=0.0.0.0:11434" # this line is mandatory. You can also specify 192.168.254.109:DIFFERENT_PORT, format
Environment="OLLAMA_ORIGINS=http://192.168.254.106:11434,https://models.server.city" # this line is optional
User=ollama
Group=ollama
Restart=always
RestartSec=3
Environment="PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/games:/usr/local/games:/s>

[Install]
WantedBy=default.target
```

## Docker Based Ollama Setup

### Setup Nvidia toolkit

```
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
    | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
    | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
    | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
sudo apt-get update

sudo apt-get install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker


```

## Install Docker

```
sudo apt install -y apt-transport-https ca-certificates curl software-properties-common
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install docker-ce -y
```


```
sudo systemctl daemon-reload
sudo systemctl restart ollama
ollama run llama3
sudo docker run -d --network=host -v open-webui:/app/backend/data -e OLLAMA_BASE_URL=http://127.0.0.1:11434 --name open-webui --restart always ghcr.io/open-webui/open-webui:main
```
## Test Your model

```
 curl http://<IP>:11434/api/chat -d '{
  "model": "llama3",
  "messages": [
    { "role": "user", "content": "What are God Particles?" }
  ],
  "stream": false
}'
```




## Update the Package
```
apt update -y
apt upgrade -y
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

## Restart service

```
sudo systemctl daemon-reload
sudo systemctl restart ollama
ollama run llama3
sudo docker run -d --network=host -v open-webui:/app/backend/data -e OLLAMA_BASE_URL=http://127.0.0.1:11434 --name open-webui --restart always ghcr.io/open-webui/open-webui:main
```



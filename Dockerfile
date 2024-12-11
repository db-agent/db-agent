FROM python:3.9-slim

# RUN apt-get update && \
#     apt-get install python3-pip -y

WORKDIR /app

COPY requirements.txt /app/

RUN echo "DB_DRIVER=postgres" > /app/.env && \
    echo "LLM=defog/llama-3-sqlcoder-8b" >> /app/.env && \
    echo "DB_HOST=postgres" >> /app/.env && \
    echo "DB_USER=postgres" >> /app/.env

RUN mkdir -p ~/.streamlit && \
    echo "[client]" > ~/.streamlit/config.toml  &&\
    echo "showSidebarNavigation = false" >> ~/.streamlit/config.toml
    

RUN pip install --no-cache-dir -r requirements.txt

COPY . /app/

EXPOSE 8501

CMD ["streamlit", "run", "db-agent.py"]

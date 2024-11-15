FROM python:3.9-slim

RUN apt-get update && \
    apt-get install python3-pip 

WORKDIR /app

COPY requirements.txt /app/

RUN pip install --no-cache-dir -r requirements.txt

COPY . /app/

EXPOSE 8501

CMD ["streamlit", "run", "datapilot.py"]

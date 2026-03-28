FROM python:3.11-slim

WORKDIR /app

# Install dependencies first (layer caching)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source
COPY . .

# Seed the demo database
RUN python scripts/seed_demo_data.py

EXPOSE 8501

# Streamlit config: disable telemetry, bind to 0.0.0.0
ENV STREAMLIT_SERVER_ADDRESS=0.0.0.0
ENV STREAMLIT_BROWSER_GATHER_USAGE_STATS=false

CMD ["streamlit", "run", "app/streamlit_app.py", "--server.port=8501"]

# dpgpt

DatapilotGPT - A copliot to help you interact with your data using natural language

- You can find the [demo video](https://www.loom.com/share/a8d7f8b56e1349ea99a7417835000e52?sid=75947c3a-e9db-4e7a-afb2-36c4c0150863) for better understanding of one of the usecase.
- Some of the [Example prompts](https://www.datapilotgpt.com/post/introduction-sql-gpt-llm-langchain) and how it can be helpful

# Quickstart Guide

### For Ubuntu/Debian-based systems:

1. **Install `pkg-config` and MySQL development files:**

```bash
sudo apt-get update
pip install -r requirements.txt
pip install fbgemm-gpu --index-url https://download.pytorch.org/whl/cu121/
```

## Postgresql Cheatsheet



### Step 1: Create a Docker Network (Optional but recommended)
To allow easy communication between Docker containers, create a Docker network:

```bash
docker network create my_network
```

### Step 2: Spin Up a PostgreSQL Container
Run the following command to start a PostgreSQL container named `pg-database`:

```bash
docker run --name pg-database \
  --network my_network \
  -e POSTGRES_USER=myuser \
  -e POSTGRES_PASSWORD=mypassword \
  -e POSTGRES_DB=mydatabase \
  -p 5432:5432 \
  -d postgres
```

### Explanation:
- `--name pg-database`: Names the container `pg-database`.
- `--network my_network`: Connects the container to the custom network `my_network`.
- `-e POSTGRES_USER=myuser`: Sets the PostgreSQL username to `myuser`.
- `-e POSTGRES_PASSWORD=mypassword`: Sets the PostgreSQL password to `mypassword`.
- `-e POSTGRES_DB=mydatabase`: Sets the default database name to `mydatabase`.
- `-p 5432:5432`: Maps port `5432` on the host to port `5432` on the container.
- `-d postgres`: Uses the official PostgreSQL image.

### Step 3: Verify the PostgreSQL Container is Running
Check the running containers:

```bash
docker ps
```

You should see your `pg-database` container running.

### Step 4: Connect to PostgreSQL using `psql`
You can use the `psql` command-line client to connect to the PostgreSQL instance. If you don’t have `psql` installed, you can use a temporary PostgreSQL Docker container to connect:

```bash
docker run -it --rm \
  --network my_network \
  postgres psql -h pg-database -U myuser -d mydatabase
```

### Explanation:
- `-it`: Opens an interactive terminal.
- `--rm`: Removes the container after exiting.
- `--network my_network`: Connects to the same Docker network as the PostgreSQL container.
- `postgres`: Uses the official PostgreSQL image.
- `psql -h pg-database -U myuser -d mydatabase`: Connects to the PostgreSQL instance running in the `pg-database` container using the specified user and database.

### Step 5: Connect Using `psql` Locally (If installed)
If `psql` is installed on your local machine, connect using:

```bash
psql -h localhost -p 5432 -U myuser -d mydatabase
```

You will be prompted to enter the password (`mypassword`).

### Step 6: Verify Connection and List Databases
Once connected, you can verify by listing the databases:

```sql
\l
```

You should see `mydatabase` listed.

### Optional: Stop and Remove the Container
When you're done, stop and remove the container:

```bash
docker stop pg-database
docker rm pg-database
```

Let me know if you'd like to see additional configurations or help with other steps!

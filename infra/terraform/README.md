# Terraform Infrastructure

This folder contains starter infrastructure definitions for services that can
support DB Agent outside the application runtime itself.

## Layout

- `digitalocean/` provisions a DigitalOcean managed PostgreSQL database.
- `aws/` provisions an AWS RDS PostgreSQL database.

Keep Kubernetes application deployment in `deploy/k8s/`. Terraform should create
supporting cloud resources; GitHub Actions should continue to build and deploy
the application image.

## State

Do not commit local state or real variable files. Commit only example files such
as `terraform.tfvars.example`.

For GitHub Actions, prefer configuring an S3 backend with these repository
variables:

- `TF_BACKEND_BUCKET`
- `TF_BACKEND_KEY`
- `TF_BACKEND_DYNAMODB_TABLE` optional, for state locking

## AWS RDS Workflow

The `Deploy AWS RDS` workflow provisions a public PostgreSQL RDS instance and
updates the Kubernetes `db-agent-secrets` secret with `DB_URL`.

Required GitHub secrets:

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `RDS_DATABASE_PASSWORD`
- `KUBECONFIG`

Required GitHub variables:

- `AWS_VPC_ID`
- `AWS_PUBLIC_SUBNET_IDS_JSON`, for example `["subnet-aaa","subnet-bbb"]`

Optional GitHub variables:

- `AWS_REGION`, default `us-east-1`
- `RDS_PROJECT_NAME`, default `db-agent`
- `RDS_DATABASE_NAME`, default `db_agent`
- `RDS_DATABASE_USERNAME`, default `dbagent`
- `RDS_ALLOWED_CIDR_BLOCKS_JSON`, default `["0.0.0.0/0"]`

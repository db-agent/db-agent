# ── Locals ────────────────────────────────────────────────────────────────────

locals {
  common_tags = {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

# ── Network ───────────────────────────────────────────────────────────────────

data "aws_vpc" "default" {
  default = true
}

# Exclude us-east-1e (zone ID use1-az3) — same AZ that EKS excludes.
# RDS requires subnets in at least 2 AZs; keeping both sets consistent avoids
# connection issues when EKS nodes route to RDS across AZ boundaries.
data "aws_availability_zones" "rds" {
  state            = "available"
  exclude_zone_ids = ["use1-az3"]
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
  filter {
    name   = "availabilityZone"
    values = data.aws_availability_zones.rds.names
  }
}

# ── RDS Subnet Group ──────────────────────────────────────────────────────────

resource "aws_db_subnet_group" "this" {
  name       = "${var.project_name}-db-subnets"
  subnet_ids = data.aws_subnets.default.ids

  tags = merge(local.common_tags, { Name = "${var.project_name}-db-subnets" })
}

# ── Security Group ────────────────────────────────────────────────────────────
# Allow PostgreSQL from within the VPC only — covers EKS pods, bastion hosts,
# or any other resource in the same VPC.  No public internet access.

resource "aws_security_group" "rds" {
  name        = "${var.project_name}-rds"
  description = "PostgreSQL access from within the VPC"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "PostgreSQL from VPC (EKS pods)"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = [data.aws_vpc.default.cidr_block]
  }

  dynamic "ingress" {
    for_each = length(var.local_access_cidrs) > 0 ? [1] : []
    content {
      description = "PostgreSQL from allowed public CIDRs (local access)"
      from_port   = 5432
      to_port     = 5432
      protocol    = "tcp"
      cidr_blocks = var.local_access_cidrs
    }
  }

  tags = merge(local.common_tags, { Name = "${var.project_name}-rds" })
}

# ── KMS key — S3 data staging ─────────────────────────────────────────────────

resource "aws_kms_key" "s3" {
  description             = "S3 data staging bucket encryption key"
  deletion_window_in_days = 7
  enable_key_rotation     = true

  tags = merge(local.common_tags, { Name = "${var.project_name}-s3-key" })
}

resource "aws_kms_alias" "s3" {
  name          = "alias/${var.project_name}-s3"
  target_key_id = aws_kms_key.s3.key_id
}

# ── S3 Bucket — access logs ───────────────────────────────────────────────────

resource "aws_s3_bucket" "logs" {
  bucket        = "${var.s3_bucket_name}-logs"
  force_destroy = true

  tags = merge(local.common_tags, { Name = "${var.s3_bucket_name}-logs", Purpose = "access-logs" })
}

resource "aws_s3_bucket_public_access_block" "logs" {
  bucket                  = aws_s3_bucket.logs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ── S3 Bucket — data staging for EKS data-load Job ───────────────────────────

resource "aws_s3_bucket" "data" {
  bucket        = var.s3_bucket_name
  force_destroy = true

  tags = merge(local.common_tags, { Name = var.s3_bucket_name, Purpose = "data-staging" })
}

resource "aws_s3_bucket_versioning" "data" {
  bucket = aws_s3_bucket.data.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "data" {
  bucket = aws_s3_bucket.data.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.s3.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "data" {
  bucket                  = aws_s3_bucket.data.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_logging" "data" {
  bucket        = aws_s3_bucket.data.id
  target_bucket = aws_s3_bucket.logs.id
  target_prefix = "access-logs/"
}

# ── RDS PostgreSQL ────────────────────────────────────────────────────────────

resource "aws_db_instance" "this" {
  identifier        = "${var.project_name}-postgres"
  engine            = "postgres"
  engine_version    = "16"
  instance_class    = var.database_instance_class
  allocated_storage = var.database_allocated_storage

  db_name  = var.database_name
  username = var.database_username
  password = var.database_password

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.rds.id]

  # Internal only — EKS pods reach RDS via VPC-private DNS.
  # Set to true only if you need a public endpoint (e.g. local psql access).
  #trivy:ignore:AVD-AWS-0180
  publicly_accessible = var.publicly_accessible

  storage_encrypted                   = true
  iam_database_authentication_enabled = true
  deletion_protection                 = true
  skip_final_snapshot                 = true

  backup_retention_period = 30
  performance_insights_enabled = true

  tags = merge(local.common_tags, { Name = "${var.project_name}-postgres" })
}

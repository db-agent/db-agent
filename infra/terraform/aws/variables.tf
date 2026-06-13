variable "aws_region" {
  description = "AWS region for RDS"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Name prefix for all resources"
  type        = string
  default     = "db-agent"
}

variable "environment" {
  description = "Deployment environment tag (dev / staging / prod)"
  type        = string
  default     = "dev"

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be one of: dev, staging, prod."
  }
}

variable "database_name" {
  description = "PostgreSQL database name"
  type        = string
  default     = "db_agent"
}

variable "database_username" {
  description = "Master database username"
  type        = string
  default     = "dbagent"
}

variable "database_password" {
  description = "Master database password (use a strong random value)"
  type        = string
  sensitive   = true
}

variable "database_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t4g.micro"
}

variable "database_allocated_storage" {
  description = "Allocated storage in GiB"
  type        = number
  default     = 20
}

variable "s3_bucket_name" {
  description = "Name of the S3 bucket used to stage CSV files for the EKS data-load Job"
  type        = string
  # Must be globally unique — override in terraform.tfvars with your own name.
  default     = "db-agent-data-staging"
}

variable "local_access_cidrs" {
  description = "CIDRs allowed to reach PostgreSQL from outside the VPC (e.g. your laptop). Set to [\"0.0.0.0/0\"] for open dev access or [\"YOUR_IP/32\"] to restrict to one machine."
  type        = list(string)
  default     = []
}

variable "publicly_accessible" {
  description = "Expose a public endpoint (false = VPC-internal only; set true only for local dev access)"
  type        = bool
  default     = false
}

variable "aws_region" {
  description = "AWS region for RDS."
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Name prefix for DB Agent infrastructure."
  type        = string
  default     = "db-agent"
}


variable "allowed_cidr_blocks" {
  description = "CIDR blocks allowed to connect to PostgreSQL."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "publicly_accessible" {
  description = "Whether RDS should receive a public endpoint."
  type        = bool
  default     = true
}

variable "database_name" {
  description = "Application database name."
  type        = string
  default     = "db_agent"
}

variable "database_username" {
  description = "Master database username."
  type        = string
  default     = "dbagent"
}

variable "database_password" {
  description = "Master database password."
  type        = string
  sensitive   = true
}

variable "database_instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t4g.micro"
}

variable "database_allocated_storage" {
  description = "Allocated database storage in GiB."
  type        = number
  default     = 20
}

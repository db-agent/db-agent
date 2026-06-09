variable "project_name" {
  description = "Name prefix for DB Agent infrastructure."
  type        = string
  default     = "db-agent"
}

variable "region" {
  description = "DigitalOcean region slug."
  type        = string
  default     = "tor1"
}

variable "database_engine" {
  description = "Managed database engine."
  type        = string
  default     = "pg"
}

variable "database_version" {
  description = "Managed database engine version."
  type        = string
  default     = "16"
}

variable "database_size" {
  description = "DigitalOcean database node size."
  type        = string
  default     = "db-s-1vcpu-1gb"
}

variable "database_node_count" {
  description = "Number of database nodes."
  type        = number
  default     = 1
}

variable "database_name" {
  description = "Application database name."
  type        = string
  default     = "db_agent"
}

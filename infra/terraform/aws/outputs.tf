output "database_endpoint" {
  description = "RDS endpoint."
  value       = aws_db_instance.db_agent.endpoint
}

output "database_host" {
  description = "RDS host."
  value       = aws_db_instance.db_agent.address
}

output "database_port" {
  description = "RDS port."
  value       = aws_db_instance.db_agent.port
}

output "database_name" {
  description = "Application database name."
  value       = aws_db_instance.db_agent.db_name
}

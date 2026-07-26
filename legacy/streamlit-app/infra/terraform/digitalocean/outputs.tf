output "database_cluster_id" {
  description = "DigitalOcean managed database cluster ID."
  value       = digitalocean_database_cluster.db_agent.id
}

output "database_host" {
  description = "Database host."
  value       = digitalocean_database_cluster.db_agent.host
}

output "database_port" {
  description = "Database port."
  value       = digitalocean_database_cluster.db_agent.port
}

output "database_name" {
  description = "Application database name."
  value       = digitalocean_database_db.app.name
}

output "database_uri" {
  description = "Database connection URI. Treat this output as sensitive."
  value       = digitalocean_database_cluster.db_agent.uri
  sensitive   = true
}

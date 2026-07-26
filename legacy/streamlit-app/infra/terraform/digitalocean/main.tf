resource "digitalocean_database_cluster" "db_agent" {
  name       = "${var.project_name}-postgres"
  engine     = var.database_engine
  version    = var.database_version
  size       = var.database_size
  region     = var.region
  node_count = var.database_node_count
}

resource "digitalocean_database_db" "app" {
  cluster_id = digitalocean_database_cluster.db_agent.id
  name       = var.database_name
}

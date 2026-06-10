output "cluster_name" {
  description = "EKS cluster name."
  value       = aws_eks_cluster.db_agent.name
}

output "cluster_endpoint" {
  description = "EKS cluster API endpoint."
  value       = aws_eks_cluster.db_agent.endpoint
}

output "cluster_certificate_authority_data" {
  description = "Base64-encoded certificate authority data for the cluster."
  value       = aws_eks_cluster.db_agent.certificate_authority[0].data
}

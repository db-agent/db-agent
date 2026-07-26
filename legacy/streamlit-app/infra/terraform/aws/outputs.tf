output "database_host" {
  description = "RDS hostname (private DNS within the VPC)"
  value       = aws_db_instance.this.address
}

output "database_port" {
  description = "RDS port"
  value       = aws_db_instance.this.port
}

output "database_name" {
  description = "PostgreSQL database name"
  value       = aws_db_instance.this.db_name
}

output "database_endpoint" {
  description = "host:port combined endpoint"
  value       = aws_db_instance.this.endpoint
}

output "db_url" {
  description = "SQLAlchemy connection string — paste into DB_URL secret"
  value       = "postgresql://${var.database_username}:${var.database_password}@${aws_db_instance.this.address}:${aws_db_instance.this.port}/${var.database_name}"
  sensitive   = true
}

output "s3_bucket_name" {
  description = "S3 bucket name — use this when uploading CSVs and in the k8s secret"
  value       = aws_s3_bucket.data.bucket
}

output "s3_bucket_arn" {
  description = "S3 bucket ARN — use when attaching IAM policies"
  value       = aws_s3_bucket.data.arn
}

output "upload_command" {
  description = "aws s3 sync command to stage your CSV files"
  value       = "aws s3 sync /path/to/Ecommerce_data s3://${aws_s3_bucket.data.bucket}/ecommerce-data/ --exclude '*.DS_Store'"
}

output "rds_security_group_id" {
  description = "ID of the RDS security group — add this to EKS node SG egress if needed"
  value       = aws_security_group.rds.id
}

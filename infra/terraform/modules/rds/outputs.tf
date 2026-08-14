output "endpoint" {
  value = aws_db_instance.this.address
}

output "port" {
  value = aws_db_instance.this.port
}

output "database_url" {
  description = "Ready to drop into the citramac/{env}/backend secret's DATABASE_URL key."
  value       = "postgres://${var.db_username}:${random_password.db_password.result}@${aws_db_instance.this.address}:${aws_db_instance.this.port}/${var.db_name}"
  sensitive   = true
}

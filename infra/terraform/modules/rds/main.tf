# RDS module — docs/12-DEVOPS-DEPLOYMENT.md §12.4: "managed Postgres,
# multi-AZ, automated backups, KMS." docs/09-SECURITY-COMPLIANCE.md §9.1:
# encryption at rest via managed DB KMS keys.

resource "random_password" "db_password" {
  length  = 32
  special = false # avoid characters requiring extra escaping in DATABASE_URL
}

resource "aws_kms_key" "rds" {
  description         = "${var.name_prefix} RDS encryption-at-rest key"
  enable_key_rotation = true
  tags                = var.tags
}

resource "aws_db_subnet_group" "this" {
  name       = "${var.name_prefix}-rds"
  subnet_ids = var.private_subnet_ids
  tags       = var.tags
}

resource "aws_db_instance" "this" {
  identifier     = "${var.name_prefix}-postgres"
  engine         = "postgres"
  engine_version = "16"
  instance_class = var.instance_class

  allocated_storage     = var.allocated_storage_gb
  max_allocated_storage = var.allocated_storage_gb * 4 # storage autoscaling ceiling
  storage_encrypted     = true
  kms_key_id            = aws_kms_key.rds.arn

  db_name  = var.db_name
  username = var.db_username
  password = random_password.db_password.result
  port     = 5432

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [var.vpc_security_group_id]
  publicly_accessible    = false

  multi_az                = var.multi_az
  backup_retention_period = var.backup_retention_days
  # Point-in-time-recovery is implied by backup_retention_period > 0 on RDS;
  # docs/09-SECURITY-COMPLIANCE.md §9.6's 7-year cold-storage archive
  # requirement is a separate, longer-term snapshot-export process, not
  # modeled by this resource alone.
  deletion_protection       = var.multi_az # a rough proxy for "this is production" until envs pass an explicit flag
  skip_final_snapshot       = !var.multi_az
  final_snapshot_identifier = var.multi_az ? "${var.name_prefix}-postgres-final" : null

  tags = var.tags
}

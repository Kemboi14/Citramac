# Storage module — docs/12-DEVOPS-DEPLOYMENT.md §12.4: "S3 bucket for
# attachments/backups, versioned + encrypted." Backs Django's
# django-storages-based file storage (attachments/%Y/%m/ uploads — see
# apps/client_registry/models.py's Attachment model) and the pg_dump
# output from backend/scripts/backup_db.sh once that runs from a CI/cron
# job instead of a manual drill.

resource "aws_kms_key" "storage" {
  description         = "${var.name_prefix} S3 encryption-at-rest key"
  enable_key_rotation = true
  tags                = var.tags
}

resource "aws_s3_bucket" "this" {
  bucket = "${var.name_prefix}-storage"
  tags   = var.tags
}

resource "aws_s3_bucket_versioning" "this" {
  bucket = aws_s3_bucket.this.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  bucket = aws_s3_bucket.this.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.storage.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "this" {
  bucket                  = aws_s3_bucket.this.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "this" {
  bucket = aws_s3_bucket.this.id

  rule {
    id     = "backups-to-cold-storage"
    status = "Enabled"
    filter {
      prefix = "backups/"
    }
    # docs/09-SECURITY-COMPLIANCE.md §9.6: "monthly archives to cold storage
    # for 7 years to satisfy medical-record retention norms — confirm exact
    # figure with legal/DHA guidance before production go-live."
    transition {
      days          = 90
      storage_class = "GLACIER"
    }
    expiration {
      days = 2557 # ~7 years; revisit once legal/DHA confirms the exact figure
    }
  }

  rule {
    id     = "expire-noncurrent-attachment-versions"
    status = "Enabled"
    filter {
      prefix = "attachments/"
    }
    noncurrent_version_expiration {
      noncurrent_days = 365
    }
  }
}

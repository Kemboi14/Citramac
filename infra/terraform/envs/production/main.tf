# production environment — wires the vpc/eks/rds/storage modules together.
# No manual console changes (docs/12-DEVOPS-DEPLOYMENT.md §12.4): every
# change here goes through a `terraform plan` reviewed in PR
# (terraform-plan.yml) then `terraform apply` gated on manual approval
# (terraform-apply.yml).

terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # See envs/dev/main.tf's backend block comment — same bootstrap caveat
  # applies here, with production's own state bucket/lock table.
  backend "s3" {
    bucket         = "citramac-terraform-state-production"
    key            = "production/terraform.tfstate"
    region         = "af-south-1"
    dynamodb_table = "citramac-terraform-locks-production"
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = local.tags
  }
}

locals {
  name_prefix = "citramac-production"
  tags = {
    environment = "production"
    project     = "citramac"
    managed-by  = "terraform"
  }
}

module "vpc" {
  source = "../../modules/vpc"

  name_prefix        = local.name_prefix
  vpc_cidr           = "10.30.0.0/16"
  az_count           = 3
  single_nat_gateway = false # per-AZ NAT — production shouldn't share a single-AZ failure domain for egress
  tags               = local.tags
}

module "eks" {
  source = "../../modules/eks"

  name_prefix         = local.name_prefix
  vpc_id              = module.vpc.vpc_id
  private_subnet_ids  = module.vpc.private_subnet_ids
  node_instance_types = ["t3.xlarge"]
  node_desired_size   = 3
  node_min_size       = 3
  node_max_size       = 10
  tags                = local.tags
}

module "rds" {
  source = "../../modules/rds"

  name_prefix           = local.name_prefix
  private_subnet_ids    = module.vpc.private_subnet_ids
  vpc_security_group_id = module.vpc.rds_security_group_id
  instance_class        = "db.r6g.large"
  allocated_storage_gb  = 100
  multi_az              = true
  # docs/09-SECURITY-COMPLIANCE.md §9.6: minimum 35 days rolling backup
  # retention in production (plus the storage module's separate 7-year cold
  # archive lifecycle rule for exported snapshots).
  backup_retention_days = 35
  tags                  = local.tags
}

module "storage" {
  source = "../../modules/storage"

  name_prefix = local.name_prefix
  tags        = local.tags
}

resource "random_password" "django_secret_key" {
  length  = 50
  special = true
}

resource "aws_secretsmanager_secret" "backend" {
  name = "citramac/production/backend"
  tags = local.tags
}

resource "aws_secretsmanager_secret_version" "backend" {
  secret_id = aws_secretsmanager_secret.backend.id
  secret_string = jsonencode({
    DATABASE_URL      = module.rds.database_url
    DJANGO_SECRET_KEY = random_password.django_secret_key.result
  })
}

# staging environment — wires the vpc/eks/rds/storage modules together.
# Closer to production sizing than dev (multi-AZ RDS, 2 AZs) since staging
# is where the deploy-staging.yml pipeline validates a release before
# production promotion.

terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # See envs/dev/main.tf's backend block comment — same bootstrap caveat
  # applies here, with staging's own state bucket/lock table.
  backend "s3" {
    bucket         = "citramac-terraform-state-staging"
    key            = "staging/terraform.tfstate"
    region         = "af-south-1"
    dynamodb_table = "citramac-terraform-locks-staging"
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
  name_prefix = "citramac-staging"
  tags = {
    environment = "staging"
    project     = "citramac"
    managed-by  = "terraform"
  }
}

module "vpc" {
  source = "../../modules/vpc"

  name_prefix        = local.name_prefix
  vpc_cidr           = "10.20.0.0/16"
  az_count           = 2
  single_nat_gateway = true
  tags               = local.tags
}

module "eks" {
  source = "../../modules/eks"

  name_prefix         = local.name_prefix
  vpc_id              = module.vpc.vpc_id
  private_subnet_ids  = module.vpc.private_subnet_ids
  node_instance_types = ["t3.large"]
  node_desired_size   = 2
  node_min_size       = 2
  node_max_size       = 4
  tags                = local.tags
}

module "rds" {
  source = "../../modules/rds"

  name_prefix           = local.name_prefix
  private_subnet_ids    = module.vpc.private_subnet_ids
  vpc_security_group_id = module.vpc.rds_security_group_id
  instance_class        = "db.t4g.medium"
  allocated_storage_gb  = 50
  multi_az              = true
  backup_retention_days = 14
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
  name = "citramac/staging/backend"
  tags = local.tags
}

resource "aws_secretsmanager_secret_version" "backend" {
  secret_id = aws_secretsmanager_secret.backend.id
  secret_string = jsonencode({
    DATABASE_URL      = module.rds.database_url
    DJANGO_SECRET_KEY = random_password.django_secret_key.result
  })
}

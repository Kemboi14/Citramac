# dev environment — wires the vpc/eks/rds/storage modules together.
# docs/12-DEVOPS-DEPLOYMENT.md §12.4: "own remote state backend" per
# environment; cost-conscious defaults (single NAT gateway, single-AZ RDS,
# small node group) since this environment is disposable.

terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # The state bucket/lock table themselves must exist before this backend
  # can be used — a one-time, manually-run bootstrap (or a separate,
  # smaller Terraform config with local state), never created by the same
  # config whose state it will hold. Not yet provisioned in any real AWS
  # account as of this commit.
  backend "s3" {
    bucket         = "citramac-terraform-state-dev"
    key            = "dev/terraform.tfstate"
    region         = "af-south-1"
    dynamodb_table = "citramac-terraform-locks-dev"
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
  name_prefix = "citramac-dev"
  tags = {
    environment = "dev"
    project     = "citramac"
    managed-by  = "terraform"
  }
}

module "vpc" {
  source = "../../modules/vpc"

  name_prefix        = local.name_prefix
  vpc_cidr           = "10.10.0.0/16"
  az_count           = 2
  single_nat_gateway = true
  tags               = local.tags
}

module "eks" {
  source = "../../modules/eks"

  name_prefix         = local.name_prefix
  vpc_id              = module.vpc.vpc_id
  private_subnet_ids  = module.vpc.private_subnet_ids
  node_instance_types = ["t3.medium"]
  node_desired_size   = 1
  node_min_size       = 1
  node_max_size       = 3
  tags                = local.tags
}

module "rds" {
  source = "../../modules/rds"

  name_prefix           = local.name_prefix
  private_subnet_ids    = module.vpc.private_subnet_ids
  vpc_security_group_id = module.vpc.rds_security_group_id
  instance_class        = "db.t4g.micro"
  allocated_storage_gb  = 20
  multi_az              = false
  backup_retention_days = 3
  tags                  = local.tags
}

module "storage" {
  source = "../../modules/storage"

  name_prefix = local.name_prefix
  tags        = local.tags
}

# Composes the secret the ExternalSecret in infra/k8s/overlays/dev reads
# (citramac/dev/backend) — see infra/k8s/base/external-secret.yaml.
resource "random_password" "django_secret_key" {
  length  = 50
  special = true
}

resource "aws_secretsmanager_secret" "backend" {
  name = "citramac/dev/backend"
  tags = local.tags
}

resource "aws_secretsmanager_secret_version" "backend" {
  secret_id = aws_secretsmanager_secret.backend.id
  secret_string = jsonencode({
    DATABASE_URL      = module.rds.database_url
    DJANGO_SECRET_KEY = random_password.django_secret_key.result
  })
}

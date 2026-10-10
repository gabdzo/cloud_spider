# The Terraform twin of upgrades/rds (Pulumi): the same private VPC and RDS
# PostgreSQL, made from two modules. Every resource gets the provider's
# default_tags, project=tf-rds and managed-by=terraform, so Cloud Spider's
# vault tf-rds (vaults/templates/tf-rds.yaml) claims them like a Pulumi stack.
# About $0.02/h, $0.48/day, $14.48/month in eu-north-1 while it exists.
#
#   cd terraform/stacks/rds
#   terraform init
#   terraform plan -out tfplan
#   terraform apply tfplan
#   terraform destroy            # deletes the database, data included
provider "aws" {
  region              = "eu-north-1"
  profile             = var.aws_profile
  allowed_account_ids = ["550536272523"]
  default_tags {
    tags = {
      project      = "tf-rds"
      "managed-by" = "terraform"
      cloudspider  = "expendable"
    }
  }
}

module "network" {
  source = "../../modules/network"
  name   = var.name
  cidr   = "10.45.0.0/16"
  private_subnets = {
    "eu-north-1a" = "10.45.1.0/24"
    "eu-north-1b" = "10.45.2.0/24"
  }
}

module "db" {
  source       = "../../modules/rds-postgres"
  name         = var.name
  vpc_id       = module.network.vpc_id
  subnet_ids   = module.network.private_subnet_ids
  allowed_cidr = module.network.cidr
}

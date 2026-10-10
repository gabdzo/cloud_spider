terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
  }
  # The same state bucket as the Pulumi stacks, its own key. S3-native
  # locking (use_lockfile), no DynamoDB table. Override with
  #   terraform init -backend-config=...   or   -backend=false (validate only)
  backend "s3" {
    bucket       = "cloudspider-state-550536272523"
    key          = "terraform/rds.tfstate"
    region       = "eu-north-1"
    profile      = "default"
    use_lockfile = true
    encrypt      = true
  }
}

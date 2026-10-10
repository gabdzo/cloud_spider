# terraform test, with a mock provider: no AWS account, no credentials.
#   cd terraform/stacks/rds && terraform init -backend=false && terraform test
mock_provider "aws" {}

variables {
  aws_profile = "default"
}

run "cheapest_private_postgres" {
  command = plan

  assert {
    condition     = module.db.identifier == "cloudspider-tf-rds"
    error_message = "the DB is named after var.name"
  }
}

run "db_settings" {
  command = plan
  module {
    source = "../../modules/rds-postgres"
  }
  variables {
    name         = "cloudspider-tf-rds"
    vpc_id       = "vpc-123"
    subnet_ids   = ["subnet-a", "subnet-b"]
    allowed_cidr = "10.45.0.0/16"
  }

  assert {
    condition     = aws_db_instance.db.instance_class == "db.t4g.micro" && aws_db_instance.db.allocated_storage == 20 && aws_db_instance.db.storage_type == "gp3"
    error_message = "db.t4g.micro, 20 GB gp3"
  }
  assert {
    condition     = aws_db_instance.db.publicly_accessible == false && aws_db_instance.db.multi_az == false
    error_message = "private and single-AZ"
  }
  assert {
    condition     = aws_db_instance.db.manage_master_user_password == true && aws_db_instance.db.password == null
    error_message = "the password is RDS-managed in Secrets Manager, never in state"
  }
  assert {
    condition     = aws_db_instance.db.skip_final_snapshot && !aws_db_instance.db.deletion_protection && aws_db_instance.db.backup_retention_period == 0
    error_message = "destroy must just work"
  }
  assert {
    condition     = one(aws_security_group.db.ingress).cidr_blocks == tolist(["10.45.0.0/16"]) && one(aws_security_group.db.ingress).from_port == 5432
    error_message = "5432 from the VPC only"
  }
}

run "network_is_private" {
  command = plan
  module {
    source = "../../modules/network"
  }
  variables {
    name = "cloudspider-tf-rds"
  }

  assert {
    condition     = alltrue([for subnet in aws_subnet.private : subnet.map_public_ip_on_launch == false])
    error_message = "no public IPs in the private subnets"
  }
  assert {
    condition     = length(aws_subnet.private) == 2
    error_message = "two zones"
  }
}

run "network_needs_two_zones" {
  command = plan
  module {
    source = "../../modules/network"
  }
  variables {
    name            = "x-net"
    private_subnets = { "eu-north-1a" = "10.45.1.0/24" }
  }
  expect_failures = [var.private_subnets]
}

# RDS PostgreSQL at the cheapest dev settings: db.t4g.micro, gp3, single-AZ,
# private, no backups kept, no final snapshot, no deletion protection. The
# master password is made and kept by RDS in Secrets Manager
# (manage_master_user_password), so it is never in Terraform state.
terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = ">= 6.0" }
  }
}

resource "aws_security_group" "db" {
  name_prefix = "${var.name}-db-"
  description = "PostgreSQL from inside the VPC only"
  vpc_id      = var.vpc_id
  tags        = { Name = var.name }

  ingress {
    description = "postgres from the VPC"
    protocol    = "tcp"
    from_port   = 5432
    to_port     = 5432
    cidr_blocks = [var.allowed_cidr]
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_db_subnet_group" "db" {
  name       = "${var.name}-subnets"
  subnet_ids = var.subnet_ids
  tags       = { Name = var.name }
}

resource "aws_db_instance" "db" {
  identifier                   = var.name
  engine                       = "postgres"
  engine_version               = var.engine_version
  instance_class               = var.instance_class
  allocated_storage            = var.storage_gb
  storage_type                 = "gp3"
  storage_encrypted            = true
  db_name                      = "app"
  username                     = "app_admin"
  manage_master_user_password  = true
  db_subnet_group_name         = aws_db_subnet_group.db.name
  vpc_security_group_ids       = [aws_security_group.db.id]
  publicly_accessible          = false
  multi_az                     = false
  backup_retention_period      = 0
  skip_final_snapshot          = true
  deletion_protection          = false
  performance_insights_enabled = false
  auto_minor_version_upgrade   = true
  apply_immediately            = true
  copy_tags_to_snapshot        = true
  tags                         = { Name = var.name }
}

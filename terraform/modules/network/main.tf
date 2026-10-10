# A VPC with private subnets only: no internet gateway, no NAT gateway, no
# public IPs. Enough for a database that nothing outside the VPC reaches.
terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = ">= 6.0" }
  }
}

resource "aws_vpc" "this" {
  cidr_block           = var.cidr
  enable_dns_hostnames = true
  enable_dns_support   = true
  tags                 = { Name = var.name }
}

resource "aws_subnet" "private" {
  for_each                = var.private_subnets
  vpc_id                  = aws_vpc.this.id
  cidr_block              = each.value
  availability_zone       = each.key
  map_public_ip_on_launch = false
  tags                    = { Name = "${var.name}-private-${substr(each.key, -1, 1)}", tier = "private" }
}

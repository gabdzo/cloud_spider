output "vpc_id" {
  value = aws_vpc.this.id
}

output "cidr" {
  value = aws_vpc.this.cidr_block
}

output "private_subnet_ids" {
  value = [for subnet in aws_subnet.private : subnet.id]
}

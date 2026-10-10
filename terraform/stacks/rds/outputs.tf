output "endpoint" {
  value = module.db.endpoint
}

output "port" {
  value = module.db.port
}

output "identifier" {
  value = module.db.identifier
}

output "master_secret_arn" {
  value = module.db.master_secret_arn
}

output "vpc_id" {
  value = module.network.vpc_id
}

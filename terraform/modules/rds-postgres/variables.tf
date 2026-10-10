variable "name" {
  description = "The DB identifier and name prefix."
  type        = string
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,27}$", var.name))
    error_message = "Use a short lowercase name."
  }
}

variable "vpc_id" {
  type = string
}

variable "subnet_ids" {
  description = "Private subnets in at least two zones."
  type        = list(string)
}

variable "allowed_cidr" {
  description = "Who may reach port 5432 (the VPC range)."
  type        = string
}

variable "engine_version" {
  type    = string
  default = "16"
}

variable "instance_class" {
  type    = string
  default = "db.t4g.micro"
  validation {
    condition     = contains(["db.t4g.micro", "db.t4g.small"], var.instance_class)
    error_message = "Keep it small: db.t4g.micro or db.t4g.small."
  }
}

variable "storage_gb" {
  type    = number
  default = 20
  validation {
    condition     = var.storage_gb >= 20 && var.storage_gb <= 50
    error_message = "gp3 for RDS starts at 20 GB; keep it at most 50."
  }
}

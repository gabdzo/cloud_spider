variable "name" {
  description = "Name prefix for the VPC and its subnets."
  type        = string
}

variable "cidr" {
  description = "The VPC range."
  type        = string
  default     = "10.45.0.0/16"
}

variable "private_subnets" {
  description = "Availability zone => subnet range. At least two zones (RDS needs them)."
  type        = map(string)
  default = {
    "eu-north-1a" = "10.45.1.0/24"
    "eu-north-1b" = "10.45.2.0/24"
  }
  validation {
    condition     = length(var.private_subnets) >= 2
    error_message = "Give at least two zones: a DB subnet group needs two."
  }
}

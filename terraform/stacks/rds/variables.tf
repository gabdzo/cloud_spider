variable "name" {
  description = "The DB identifier and name prefix."
  type        = string
  default     = "cloudspider-tf-rds"
}

variable "aws_profile" {
  description = "The AWS CLI profile to use."
  type        = string
  default     = "default"
}

variable "name_prefix" {
  type = string
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "vpc_security_group_id" {
  description = "The RDS security group from the vpc module — allows ingress from EKS nodes only."
  type        = string
}

variable "instance_class" {
  type    = string
  default = "db.t4g.medium"
}

variable "allocated_storage_gb" {
  type    = number
  default = 50
}

variable "multi_az" {
  description = "docs/09-SECURITY-COMPLIANCE.md §9.6: multi-AZ in production; single-AZ is an acceptable dev/staging cost tradeoff."
  type        = bool
  default     = true
}

variable "backup_retention_days" {
  description = "docs/09-SECURITY-COMPLIANCE.md §9.6 — minimum 35 days rolling in production."
  type        = number
  default     = 7
}

variable "db_name" {
  type    = string
  default = "citramac"
}

variable "db_username" {
  type    = string
  default = "citramac"
}

variable "tags" {
  type    = map(string)
  default = {}
}

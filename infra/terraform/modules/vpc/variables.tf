variable "name_prefix" {
  description = "Prefix for all resource names/tags, e.g. \"citramac-dev\"."
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC. Must be large enough for az_count public + az_count private /20 subnets."
  type        = string
  default     = "10.0.0.0/16"
}

variable "az_count" {
  description = "Number of Availability Zones to spread subnets across."
  type        = number
  default     = 2
}

variable "single_nat_gateway" {
  description = "Use one shared NAT gateway instead of one per AZ. Cheaper; set false for production."
  type        = bool
  default     = true
}

variable "tags" {
  description = "Common tags applied to every resource — docs/12-DEVOPS-DEPLOYMENT.md §12.4."
  type        = map(string)
  default     = {}
}

variable "kubeconfig_path" {
  type    = string
  default = "/etc/rancher/k3s/k3s.yaml"
}

variable "django_secret_key" {
  type      = string
  sensitive = true
}

variable "field_encryption_key" {
  type      = string
  sensitive = true
}

variable "django_allowed_hosts" {
  type    = string
  default = "demo.citramac.com"
}

variable "cors_allowed_origins" {
  type    = string
  default = "https://demo.citramac.com"
}

variable "database_url" {
  type      = string
  sensitive = true
}

variable "redis_url" {
  type    = string
  default = "redis://redis:6379/0"
}

variable "postgres_db" {
  type    = string
  default = "citramac"
}

variable "postgres_user" {
  type    = string
  default = "citramac"
}

variable "postgres_password" {
  type      = string
  sensitive = true
}

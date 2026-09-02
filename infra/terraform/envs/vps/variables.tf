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

# ── Email (OTP dispatch, activation invites) ──────────────────────────────
# Empty EMAIL_HOST default preserves the honest console-backend fallback in
# config/settings/production.py — set these in terraform.tfvars once real
# SMTP credentials exist, then `terraform apply` + roll the backend and
# celery-worker Deployments (OTP emails send from a Celery task).
variable "email_host" {
  type    = string
  default = ""
}

variable "email_port" {
  type    = string
  default = "587"
}

variable "email_host_user" {
  type      = string
  default   = ""
  sensitive = true
}

variable "email_host_password" {
  type      = string
  default   = ""
  sensitive = true
}

variable "email_use_tls" {
  type    = string
  default = "True"
}

variable "email_use_ssl" {
  type    = string
  default = "False"
}

variable "default_from_email" {
  type    = string
  default = "no-reply@citramac.local"
}

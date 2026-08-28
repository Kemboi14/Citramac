# vps environment — a single existing Contabo VPS (161.97.166.42), not AWS.
# There's no cloud account to provision VPC/EKS/RDS against here (see the
# aws-backed dev/staging/production envs for that shape), so this env uses
# the Kubernetes/Helm providers against the k3s cluster already installed
# directly on the box, and manages only the cluster-level pieces the
# existing infra/k8s/overlays/vps Kustomize tree doesn't own: the
# namespace, the ingress controller, and the app Secret (replacing the
# External-Secrets-Operator + AWS-Secrets-Manager flow the other
# environments use, since neither exists here).
#
# State is local (gitignored *.tfstate, same posture as the already-local
# /opt/citramac/.env it partially mirrors) — a remote backend needs a
# bucket/account this deployment doesn't have, same caveat the AWS envs'
# own S3 backends already carry ("must exist before this backend can be
# used").

terraform {
  required_version = ">= 1.5"
  required_providers {
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.31"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.14"
    }
  }
}

provider "kubernetes" {
  config_path = var.kubeconfig_path
}

provider "helm" {
  kubernetes {
    config_path = var.kubeconfig_path
  }
}

resource "kubernetes_namespace" "citramac" {
  metadata {
    name = "citramac"
    labels = {
      project = "citramac"
    }
  }
}

# Default ClusterIP service — deliberately not NodePort/LoadBalancer. A
# ClusterIP is reachable directly from the node's own host network via
# kube-proxy's iptables rules (the same mechanism that lets pods reach it),
# so the host's nginx can proxy straight to it with no port bound on the
# public interface and no firewall rule needed — the k8s-native equivalent
# of the Compose deployment's `127.0.0.1:8010`/`8011` bindings.
resource "helm_release" "ingress_nginx" {
  name             = "ingress-nginx"
  repository       = "https://kubernetes.github.io/ingress-nginx"
  chart            = "ingress-nginx"
  version          = "~> 4.11"
  namespace        = "ingress-nginx"
  create_namespace = true

  set {
    name  = "controller.service.type"
    value = "ClusterIP"
  }

  # k3s's default Traefik/ServiceLB is disabled at install time specifically
  # so this controller doesn't fight it for admission — nothing here needs
  # the IngressClass to also be the cluster default.
  set {
    name  = "controller.ingressClassResource.default"
    value = "false"
  }
}

data "kubernetes_service" "ingress_nginx_controller" {
  metadata {
    # Helm chart's default service name for the release name "ingress-nginx".
    name      = "ingress-nginx-controller"
    namespace = "ingress-nginx"
  }
  depends_on = [helm_release.ingress_nginx]
}

# Replaces infra/k8s/base/external-secret.yaml's ExternalSecret for this
# environment only — no External Secrets Operator / AWS Secrets Manager
# here. Same Secret name the Deployments already reference via
# `secretRef: {name: citramac-backend-secrets}`, so no manifest changes
# needed on the Kustomize side beyond simply not including
# external-secret.yaml (see infra/k8s/overlays/vps/kustomization.yaml).
resource "kubernetes_secret" "backend" {
  metadata {
    name      = "citramac-backend-secrets"
    namespace = kubernetes_namespace.citramac.metadata[0].name
  }

  type = "Opaque"

  data = {
    DJANGO_SECRET_KEY    = var.django_secret_key
    FIELD_ENCRYPTION_KEY = var.field_encryption_key
    DJANGO_ALLOWED_HOSTS = var.django_allowed_hosts
    CORS_ALLOWED_ORIGINS = var.cors_allowed_origins
    DATABASE_URL         = var.database_url
    REDIS_URL            = var.redis_url
    POSTGRES_DB          = var.postgres_db
    POSTGRES_USER        = var.postgres_user
    POSTGRES_PASSWORD    = var.postgres_password
  }
}

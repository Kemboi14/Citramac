output "ingress_nginx_cluster_ip" {
  description = "Cluster IP host nginx should proxy_pass demo.citramac.com traffic to."
  value       = data.kubernetes_service.ingress_nginx_controller.spec[0].cluster_ip
}

output "namespace" {
  value = kubernetes_namespace.citramac.metadata[0].name
}

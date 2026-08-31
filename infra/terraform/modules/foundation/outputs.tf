output "environment_fence" {
  value     = terraform_data.environment_fence.output
  sensitive = true
}

output "r2_bucket_names" {
  value = { for purpose, bucket in cloudflare_r2_bucket.private : purpose => bucket.name }
}

output "queue_names" {
  value = { for purpose, queue in cloudflare_queue.stage : purpose => queue.queue_name }
}

output "hyperdrive_ids" {
  value     = { for key, config in cloudflare_hyperdrive_config.role_scoped : key => config.id }
  sensitive = true
}

output "neon_project_id" {
  value     = var.neon_project_id
  sensitive = true
}

output "project_id" {
  value = neon_project.this.id
}

output "default_branch_id" {
  value = neon_project.this.default_branch_id
}

output "default_endpoint_id" {
  value = neon_project.this.default_endpoint_id
}

output "direct_host" {
  value = neon_project.this.database_host
}

output "database_name" {
  value = neon_project.this.database_name
}

output "bootstrap_maintenance_connection" {
  description = "Direct-only bootstrap owner path; never pass this object to a Worker or Hyperdrive."
  value = {
    environment          = var.environment
    project_id           = neon_project.this.id
    default_branch_id    = neon_project.this.default_branch_id
    default_endpoint_id  = neon_project.this.default_endpoint_id
    direct_host          = neon_project.this.database_host
    database_name        = neon_project.this.database_name
    bootstrap_login      = neon_project.this.database_user
    password             = neon_project.this.database_password
    grant_template       = "${path.module}/bootstrap-role-grants.sql.tftpl"
    attestation_template = "${path.module}/prebinding-attestation.sql.tftpl"
    worker_logins        = local.worker_logins
    permitted_roles      = ["ushso_maintenance"]
  }
  sensitive = true
}

output "bootstrap_contract" {
  value = terraform_data.bootstrap_contract.output
}

locals {
  resource_manifest_path = "${path.root}/../../../cloudflare/manifests/resources.production.json"
  resource_manifest      = jsondecode(file(local.resource_manifest_path))
}

module "neon" {
  source = "../../modules/neon-foundation"

  environment               = "production"
  organization_id           = var.neon_organization_id
  region_id                 = local.resource_manifest.neon.region
  history_retention_seconds = local.resource_manifest.neon.pitr_days * 24 * 60 * 60
  endpoint_policy = {
    autoscaling_limit_min_cu = local.resource_manifest.neon.compute_units.minimum
    autoscaling_limit_max_cu = local.resource_manifest.neon.compute_units.maximum
    suspend_timeout_seconds  = local.resource_manifest.neon.suspend_timeout_seconds
  }
}

module "foundation" {
  count  = var.cloudflare_foundation_enabled ? 1 : 0
  source = "../../modules/foundation"

  environment                 = "production"
  cloudflare_account_id       = var.cloudflare_account_id
  neon_project_id             = module.neon.project_id
  neon_branch_id              = module.neon.default_branch_id
  neon_endpoint_id            = module.neon.default_endpoint_id
  neon_direct_host            = module.neon.direct_host
  neon_database               = module.neon.database_name
  database_origins            = var.database_origins
  database_origin_attestation = var.database_origin_attestation
  attestation_template_sha256 = module.neon.bootstrap_contract.verify_template
  resource_manifest_path      = local.resource_manifest_path
  resource_revision           = var.resource_revision
}

output "foundation" {
  value     = var.cloudflare_foundation_enabled ? module.foundation[0] : null
  sensitive = true
}

output "neon_bootstrap_maintenance_connection" {
  description = "Direct-only bootstrap owner; never bind to Hyperdrive or a Worker."
  value       = module.neon.bootstrap_maintenance_connection
  sensitive   = true
}

output "neon_bootstrap_contract" {
  value = module.neon.bootstrap_contract
}

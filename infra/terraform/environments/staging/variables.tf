variable "cloudflare_account_id" {
  type      = string
  sensitive = true
  nullable  = true
  default   = null

  validation {
    condition     = !var.cloudflare_foundation_enabled || try(length(var.cloudflare_account_id) > 0, false)
    error_message = "cloudflare_account_id is required when the Cloudflare foundation phase is enabled"
  }
}

variable "cloudflare_foundation_enabled" {
  description = "Phase-two gate; false creates only the Neon project/bootstrap owner."
  type        = bool
  default     = false
}

variable "neon_organization_id" {
  description = "Staging-only Neon organization identifier."
  type        = string
  sensitive   = true
}

variable "database_origins" {
  description = "Exact six-role SQL-created login/password map from the approved ephemeral secret channel."
  type = map(object({
    database_role = string
    login_user    = string
    password      = string
  }))
  sensitive = true
  default   = {}

  validation {
    condition     = !var.cloudflare_foundation_enabled || toset(keys(var.database_origins)) == toset(["public", "scheduler", "harvest", "normalize", "projector", "ops"])
    error_message = "phase two requires the exact six-role sensitive origin map"
  }
}

variable "database_origin_attestation" {
  description = "Non-secret catalog attestation emitted after SQL login creation and before Hyperdrive binding."
  type = object({
    environment      = string
    neon_project_id  = string
    neon_branch_id   = string
    neon_endpoint_id = string
    direct_host      = string
    verified_at_utc  = string
    expires_at_utc   = string
    template_sha256  = string
    evidence_sha256  = string
    roles = map(object({
      database_role         = string
      login_user            = string
      rolsuper              = bool
      rolbypassrls          = bool
      rolreplication        = bool
      rolcreatedb           = bool
      rolcreaterole         = bool
      capability_member     = bool
      neon_superuser_member = bool
      unexpected_membership = bool
      unexpected_acl        = bool
    }))
  })
  nullable  = true
  default   = null
  sensitive = true

  validation {
    condition     = !var.cloudflare_foundation_enabled || var.database_origin_attestation != null
    error_message = "phase two requires the post-SQL-bootstrap catalog attestation"
  }
}

variable "resource_revision" {
  type = string
}

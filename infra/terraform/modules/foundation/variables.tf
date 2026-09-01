variable "environment" {
  description = "Exact isolated environment name."
  type        = string

  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production"
  }
}

variable "cloudflare_account_id" {
  description = "Environment-scoped Cloudflare account identifier. Supplied only after authorization."
  type        = string
  sensitive   = true
}

variable "neon_project_id" {
  description = "Environment-specific Neon project identifier produced by the active neon-foundation module."
  type        = string
  sensitive   = true
}

variable "neon_branch_id" {
  description = "Exact environment-specific Neon default branch identifier bound into the privilege attestation."
  type        = string
  sensitive   = true
}

variable "neon_endpoint_id" {
  description = "Exact environment-specific Neon endpoint identifier bound into the privilege attestation."
  type        = string
  sensitive   = true
}

variable "neon_direct_host" {
  description = "Direct, non-pooled Neon PostgreSQL host produced by neon_project; never a pooled endpoint."
  type        = string
  sensitive   = true

  validation {
    condition     = !can(regex("(^|[.-])pooler([.-]|$)", lower(var.neon_direct_host)))
    error_message = "Hyperdrive origin must be a direct non-pooled Neon endpoint"
  }
}

variable "neon_database" {
  type      = string
  sensitive = true
}

variable "database_origins" {
  description = "Exact role-scoped Hyperdrive origin logins. Each login may inherit only its matching NOLOGIN capability role."
  type = map(object({
    database_role = string
    login_user    = string
    password      = string
  }))
  sensitive = true

  validation {
    condition     = toset(keys(var.database_origins)) == toset(["public", "scheduler", "harvest", "normalize", "projector", "ops"])
    error_message = "database_origins must contain exactly the six Worker roles"
  }

  validation {
    condition     = alltrue([for role, origin in var.database_origins : origin.database_role == "ushso_${role}"])
    error_message = "each Hyperdrive origin must map only to its matching ushso_<worker> capability role"
  }

  validation {
    condition     = length(distinct([for origin in values(var.database_origins) : origin.login_user])) == 6
    error_message = "each Worker role requires a distinct database login identity"
  }

  validation {
    condition     = alltrue([for role, origin in var.database_origins : origin.login_user == "ushso_${var.environment}_${role}_login"])
    error_message = "each generated login identity must be environment- and role-scoped"
  }
}

variable "database_origin_attestation" {
  description = "Exact catalog proof that SQL-created Worker logins are safe before any Hyperdrive origin is materialized."
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
  sensitive = true

  validation {
    condition     = var.database_origin_attestation.environment == var.environment
    error_message = "database privilege attestation crosses the selected environment"
  }

  validation {
    condition     = !can(regex("(^|[.-])pooler([.-]|$)", lower(var.database_origin_attestation.direct_host)))
    error_message = "database privilege attestation must name the direct non-pooled Neon host"
  }

  validation {
    condition     = toset(keys(var.database_origin_attestation.roles)) == toset(["public", "scheduler", "harvest", "normalize", "projector", "ops"])
    error_message = "database privilege attestation must contain exactly the six Worker roles"
  }

  validation {
    condition = alltrue([
      for role, attestation in var.database_origin_attestation.roles : (
        attestation.database_role == "ushso_${role}" &&
        attestation.login_user == "ushso_${var.environment}_${role}_login" &&
        !attestation.rolsuper &&
        !attestation.rolbypassrls &&
        !attestation.rolreplication &&
        !attestation.rolcreatedb &&
        !attestation.rolcreaterole &&
        attestation.capability_member &&
        !attestation.neon_superuser_member &&
        !attestation.unexpected_membership &&
        !attestation.unexpected_acl
      )
    ])
    error_message = "Worker login attestation proves an elevated attribute, missing capability grant, neon_superuser membership, or unexpected membership"
  }

  validation {
    condition = (
      can(regex("^[a-f0-9]{64}$", var.database_origin_attestation.template_sha256)) &&
      can(regex("^[a-f0-9]{64}$", var.database_origin_attestation.evidence_sha256)) &&
      can(regex("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$", var.database_origin_attestation.verified_at_utc)) &&
      can(regex("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$", var.database_origin_attestation.expires_at_utc)) &&
      can(timecmp(var.database_origin_attestation.expires_at_utc, var.database_origin_attestation.verified_at_utc)) &&
      can(timecmp(var.database_origin_attestation.expires_at_utc, timeadd(var.database_origin_attestation.verified_at_utc, "15m"))) &&
      try(timecmp(var.database_origin_attestation.expires_at_utc, var.database_origin_attestation.verified_at_utc) > 0, false) &&
      try(timecmp(var.database_origin_attestation.expires_at_utc, timeadd(var.database_origin_attestation.verified_at_utc, "15m")) <= 0, false)
    )
    error_message = "Worker login attestation requires SHA-256 digests and a valid UTC window greater than zero and no longer than 15 minutes"
  }
}

variable "attestation_template_sha256" {
  description = "Digest of the reviewed prebinding catalog-attestation template."
  type        = string

  validation {
    condition     = can(regex("^[a-f0-9]{64}$", var.attestation_template_sha256))
    error_message = "attestation template digest must be lowercase SHA-256"
  }
}

variable "resource_manifest_path" {
  description = "Absolute or root-relative path to the reviewed environment resource manifest."
  type        = string
}

variable "resource_revision" {
  type = string

  validation {
    condition     = can(regex("^[a-f0-9]{64}$", var.resource_revision))
    error_message = "resource_revision must be a lowercase SHA-256 digest"
  }
}

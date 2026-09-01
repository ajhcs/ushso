locals {
  prefix              = "ushso-${var.environment}"
  manifest            = jsondecode(file(var.resource_manifest_path))
  hyperdrive_profiles = { for profile in local.manifest.hyperdrive_semantic_profiles : profile.id => profile }
  hyperdrive_configs  = { for config in local.manifest.hyperdrive_configs : "${config.worker_role}:${config.semantic_profile}" => config }

  expected_queue_names = toset([
    "harvest-page",
    "harvest-page-dlq",
    "normalize-record",
    "normalize-record-dlq",
    "enrich-schema",
    "enrich-schema-dlq",
    "access-check",
    "access-check-dlq",
    "project-index",
    "project-index-dlq",
  ])

  attestation_role_order = ["public", "scheduler", "harvest", "normalize", "projector", "ops"]
  attestation_evidence_material = join("\n", concat(
    [
      "ushso-database-origin-attestation.v1",
      "environment=${var.database_origin_attestation.environment}",
      "neon_project_id=${var.database_origin_attestation.neon_project_id}",
      "neon_branch_id=${var.database_origin_attestation.neon_branch_id}",
      "neon_endpoint_id=${var.database_origin_attestation.neon_endpoint_id}",
      "direct_host=${var.database_origin_attestation.direct_host}",
      "verified_at_utc=${var.database_origin_attestation.verified_at_utc}",
      "expires_at_utc=${var.database_origin_attestation.expires_at_utc}",
      "template_sha256=${var.database_origin_attestation.template_sha256}",
    ],
    flatten([
      for role in local.attestation_role_order : [
        "roles.${role}.database_role=${var.database_origin_attestation.roles[role].database_role}",
        "roles.${role}.login_user=${var.database_origin_attestation.roles[role].login_user}",
        "roles.${role}.rolsuper=${var.database_origin_attestation.roles[role].rolsuper}",
        "roles.${role}.rolbypassrls=${var.database_origin_attestation.roles[role].rolbypassrls}",
        "roles.${role}.rolreplication=${var.database_origin_attestation.roles[role].rolreplication}",
        "roles.${role}.rolcreatedb=${var.database_origin_attestation.roles[role].rolcreatedb}",
        "roles.${role}.rolcreaterole=${var.database_origin_attestation.roles[role].rolcreaterole}",
        "roles.${role}.capability_member=${var.database_origin_attestation.roles[role].capability_member}",
        "roles.${role}.neon_superuser_member=${var.database_origin_attestation.roles[role].neon_superuser_member}",
        "roles.${role}.unexpected_membership=${var.database_origin_attestation.roles[role].unexpected_membership}",
      ]
    ])
  ))
  attestation_evidence_sha256 = sha256(local.attestation_evidence_material)
}

resource "terraform_data" "environment_fence" {
  input = {
    environment       = var.environment
    resource_revision = var.resource_revision
    manifest_schema   = local.manifest.schema_version
    privilege_attestation = {
      neon_project_id          = var.database_origin_attestation.neon_project_id
      neon_branch_id           = var.database_origin_attestation.neon_branch_id
      neon_endpoint_id         = var.database_origin_attestation.neon_endpoint_id
      direct_host              = var.database_origin_attestation.direct_host
      template_sha256          = var.database_origin_attestation.template_sha256
      evidence_sha256          = var.database_origin_attestation.evidence_sha256
      computed_evidence_sha256 = local.attestation_evidence_sha256
      verified_at_utc          = var.database_origin_attestation.verified_at_utc
      expires_at_utc           = var.database_origin_attestation.expires_at_utc
    }
  }

  lifecycle {
    precondition {
      condition     = local.manifest.environment == var.environment
      error_message = "resource manifest environment does not match root environment"
    }
    precondition {
      condition     = local.manifest.resource_prefix == local.prefix
      error_message = "resource prefix crosses the selected environment fence"
    }
    precondition {
      condition     = var.resource_revision == filesha256(var.resource_manifest_path)
      error_message = "resource manifest digest differs from the reviewed revision"
    }
    precondition {
      condition     = toset(flatten([for q in local.manifest.queues : [q.name, q.dead_letter_queue]])) == local.expected_queue_names
      error_message = "Queue/DLQ topology differs from the reviewed WP3 contract"
    }
    precondition {
      condition     = length(local.manifest.routes) == 0 && local.manifest.workers_dev == false
      error_message = "foundation must remain zero traffic"
    }
  }
}

resource "cloudflare_r2_bucket" "private" {
  for_each = { for bucket in local.manifest.r2_buckets : bucket.purpose => bucket }

  account_id = var.cloudflare_account_id
  name       = each.value.name
  location   = each.value.location

  lifecycle {
    prevent_destroy = true
    precondition {
      condition     = each.value.public_access == false && each.value.custom_domain == null
      error_message = "WP3 R2 evidence buckets must be private and have no custom domain"
    }
  }
}

resource "cloudflare_queue" "stage" {
  for_each = toset(flatten([for q in local.manifest.queues : [q.name, q.dead_letter_queue]]))

  account_id = var.cloudflare_account_id
  queue_name = "${local.prefix}-${each.value}"

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_hyperdrive_config" "role_scoped" {
  for_each = local.hyperdrive_configs

  account_id              = var.cloudflare_account_id
  name                    = each.value.name
  origin_connection_limit = each.value.candidate_origin_connection_limit
  origin = {
    scheme   = "postgresql"
    host     = var.neon_direct_host
    port     = 5432
    database = var.neon_database
    user     = var.database_origins[each.value.worker_role].login_user
    password = var.database_origins[each.value.worker_role].password
  }
  caching = merge(
    { disabled = local.hyperdrive_profiles[each.value.semantic_profile].cache.disabled },
    local.hyperdrive_profiles[each.value.semantic_profile].cache.disabled ? {} : {
      max_age                = local.hyperdrive_profiles[each.value.semantic_profile].cache.max_age_seconds
      stale_while_revalidate = local.hyperdrive_profiles[each.value.semantic_profile].cache.stale_while_revalidate_seconds
    }
  )

  lifecycle {
    prevent_destroy = true
    precondition {
      condition     = var.database_origins[each.value.worker_role].database_role == each.value.database_role
      error_message = "Hyperdrive configuration crosses its database-role boundary"
    }
    precondition {
      condition = (
        var.database_origin_attestation.template_sha256 == var.attestation_template_sha256 &&
        var.database_origin_attestation.evidence_sha256 == local.attestation_evidence_sha256 &&
        var.database_origin_attestation.neon_project_id == var.neon_project_id &&
        var.database_origin_attestation.neon_branch_id == var.neon_branch_id &&
        var.database_origin_attestation.neon_endpoint_id == var.neon_endpoint_id &&
        var.database_origin_attestation.direct_host == var.neon_direct_host &&
        timecmp(timestamp(), var.database_origin_attestation.verified_at_utc) >= 0 &&
        timecmp(timestamp(), var.database_origin_attestation.expires_at_utc) <= 0 &&
        var.database_origin_attestation.roles[each.value.worker_role].database_role == each.value.database_role &&
        var.database_origin_attestation.roles[each.value.worker_role].login_user == var.database_origins[each.value.worker_role].login_user &&
        !var.database_origin_attestation.roles[each.value.worker_role].rolsuper &&
        !var.database_origin_attestation.roles[each.value.worker_role].rolbypassrls &&
        !var.database_origin_attestation.roles[each.value.worker_role].rolreplication &&
        !var.database_origin_attestation.roles[each.value.worker_role].rolcreatedb &&
        !var.database_origin_attestation.roles[each.value.worker_role].rolcreaterole &&
        var.database_origin_attestation.roles[each.value.worker_role].capability_member &&
        !var.database_origin_attestation.roles[each.value.worker_role].neon_superuser_member &&
        !var.database_origin_attestation.roles[each.value.worker_role].unexpected_membership
      )
      error_message = "Hyperdrive origin is prohibited until its SQL-created login passes the reviewed catalog attestation"
    }
  }
}

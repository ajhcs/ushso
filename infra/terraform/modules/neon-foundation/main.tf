locals {
  project_name    = "ushso-${var.environment}"
  database_name   = "ushso"
  bootstrap_login = "ushso_${var.environment}_bootstrap"
  worker_roles    = toset(["public", "scheduler", "harvest", "normalize", "projector", "ops"])
  worker_logins   = { for role in local.worker_roles : role => "ushso_${var.environment}_${role}_login" }
}

resource "neon_project" "this" {
  name                      = local.project_name
  org_id                    = var.organization_id
  region_id                 = var.region_id
  pg_version                = var.pg_version
  history_retention_seconds = var.history_retention_seconds
  store_password            = "yes"
  default_branch_protected  = true
  compute_provisioner       = "k8s-neonvm"

  default_endpoint_settings {
    autoscaling_limit_min_cu = var.endpoint_policy.autoscaling_limit_min_cu
    autoscaling_limit_max_cu = var.endpoint_policy.autoscaling_limit_max_cu
    suspend_timeout_seconds  = var.endpoint_policy.suspend_timeout_seconds
  }

  branch {
    name          = "main"
    database_name = local.database_name
    role_name     = local.bootstrap_login
  }

  lifecycle {
    prevent_destroy = true

    precondition {
      condition     = var.history_retention_seconds == 30 * 24 * 60 * 60
      error_message = "Neon history retention must remain exactly 30 days"
    }
  }
}

resource "terraform_data" "bootstrap_contract" {
  input = {
    environment         = var.environment
    project_id          = neon_project.this.id
    default_branch_id   = neon_project.this.default_branch_id
    default_endpoint_id = neon_project.this.default_endpoint_id
    direct_host         = neon_project.this.database_host
    database_name       = neon_project.this.database_name
    bootstrap_login     = neon_project.this.database_user
    worker_logins       = local.worker_logins
    grant_template      = filesha256("${path.module}/bootstrap-role-grants.sql.tftpl")
    verify_template     = filesha256("${path.module}/prebinding-attestation.sql.tftpl")
  }

  lifecycle {
    precondition {
      condition     = neon_project.this.database_user == local.bootstrap_login
      error_message = "Neon default branch owner differs from the reviewed bootstrap identity"
    }
    precondition {
      condition     = !can(regex("(^|[.-])pooler([.-]|$)", lower(neon_project.this.database_host)))
      error_message = "Hyperdrive and maintenance must use Neon's direct non-pooled endpoint"
    }
  }
}

variable "environment" {
  description = "Exact isolated environment name."
  type        = string

  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production"
  }
}

variable "organization_id" {
  description = "Environment-scoped Neon organization identifier supplied only after authorization."
  type        = string
  sensitive   = true
}

variable "region_id" {
  description = "Neon region selected by the reviewed residency policy."
  type        = string
  default     = "aws-us-east-1"

  validation {
    condition     = var.region_id == "aws-us-east-1"
    error_message = "WP3 is approved only for the reviewed aws-us-east-1 candidate region"
  }
}

variable "pg_version" {
  description = "PostgreSQL major version aligned with the WP3 migration harness."
  type        = number
  default     = 16

  validation {
    condition     = var.pg_version == 16
    error_message = "WP3 currently supports PostgreSQL 16 only"
  }
}

variable "history_retention_seconds" {
  description = "Exact 30-day point-in-time restore target."
  type        = number
  default     = 2592000

  validation {
    condition     = var.history_retention_seconds == 2592000
    error_message = "WP3 requires a 30-day history retention target"
  }
}

variable "endpoint_policy" {
  description = "Explicit default read-write endpoint compute and suspension policy."
  type = object({
    autoscaling_limit_min_cu = number
    autoscaling_limit_max_cu = number
    suspend_timeout_seconds  = number
  })

  validation {
    condition = (
      var.endpoint_policy.autoscaling_limit_min_cu > 0 &&
      var.endpoint_policy.autoscaling_limit_max_cu >= var.endpoint_policy.autoscaling_limit_min_cu &&
      var.endpoint_policy.suspend_timeout_seconds >= -1
    )
    error_message = "endpoint policy requires positive ordered CU limits and a suspend timeout of -1 or greater"
  }

  validation {
    condition = var.environment != "production" || (
      var.endpoint_policy.autoscaling_limit_min_cu == 1 &&
      var.endpoint_policy.autoscaling_limit_max_cu == 4 &&
      var.endpoint_policy.suspend_timeout_seconds == -1
    )
    error_message = "production requires 1-4 CU and suspend_timeout_seconds=-1"
  }
}

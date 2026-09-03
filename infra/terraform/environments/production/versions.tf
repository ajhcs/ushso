terraform {
  required_version = "= 1.16.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "= 5.24.0"
    }
    neon = {
      source  = "kislerdm/neon"
      version = "= 0.15.0"
    }
  }

  backend "s3" {}
}

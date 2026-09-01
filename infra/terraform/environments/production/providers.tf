# Authentication is supplied only by the approved environment variables named
# in infra/cloudflare/manifests/secrets-names.json. Never put tokens here.
provider "cloudflare" {}
provider "neon" {}

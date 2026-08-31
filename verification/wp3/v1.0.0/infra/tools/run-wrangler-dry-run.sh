#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
temporary_root="$(mktemp -d /tmp/ushso-wp3-wrangler.XXXXXX)"

cleanup() {
  if [[ "${temporary_root}" == /tmp/ushso-wp3-wrangler.* ]]; then
    rm -rf -- "${temporary_root}"
  fi
}
trap cleanup EXIT

wrangler_cli="${repo_root}/node_modules/wrangler/bin/wrangler.js"
if [[ ! -f "${wrangler_cli}" ]]; then
  echo "FAIL local Wrangler is missing" >&2
  exit 1
fi

count=0
for environment in staging production; do
  for role in public scheduler harvest normalize projector ops; do
    label="${environment}-${role}"
    config="${repo_root}/infra/cloudflare/rendered/${environment}/${role}.wrangler.json"
    outdir="${temporary_root}/bundle/${label}"
    log_file="${temporary_root}/${label}.wrangler.log"
    output_file="${temporary_root}/${label}.stdout.log"
    mkdir -p "${outdir}"
    if ! (
      cd "${temporary_root}"
      WRANGLER_LOG_PATH="${log_file}" \
      WRANGLER_SEND_METRICS=false \
      NO_COLOR=1 \
        node "${wrangler_cli}" deploy --dry-run --config "${config}" --outdir "${outdir}"
    ) >"${output_file}" 2>&1; then
      echo "FAIL ${label}: Wrangler dry-run failed" >&2
      sed -n '1,200p' "${output_file}" >&2
      exit 1
    fi
    if ! rg -q -- "--dry-run: exiting now\." "${output_file}"; then
      echo "FAIL ${label}: Wrangler did not confirm dry-run" >&2
      sed -n '1,200p' "${output_file}" >&2
      exit 1
    fi
    count=$((count + 1))
    echo "PASS ${label}"
  done
done

if [[ "${count}" -ne 12 ]]; then
  echo "FAIL expected 12 configs, checked ${count}" >&2
  exit 1
fi
echo "PASS Wrangler 4.127.1 offline dry-run 12/12; no credentials or provider API"

// Replaced at bundle time by the reviewed Wrangler wrapper. No deployment ID is inferred.
const identity = typeof USHSO_RUNTIME_BUILD_IDENTITY === 'undefined' ? null : USHSO_RUNTIME_BUILD_IDENTITY;
export function runtimeBuildIdentity() {
  if (!identity || identity.schema_version !== 'ushso.runtime-build-identity.v1' || !/^[a-f0-9]{64}$/.test(identity.build_id ?? '')) return {identity:null,state:'not_configured'};
  return {identity,state:'identified',scope:'Source graph and staged asset identity; Cloudflare deployment identity is recorded separately.'};
}

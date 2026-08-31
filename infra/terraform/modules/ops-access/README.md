# Cloudflare Access operations application template

The active Access application and operator/service-token membership cannot be
materialized without the approved account, identity provider, hostname, and
operator groups. `ops-access-policy.json.tftpl` is the reviewed input contract
for that authorized step. It denies public inclusion, requires an explicit ops
group or separately scoped service token, limits sessions, and requires the ops
Worker to append an audit event for every mutation.

No DNS resource or Worker route is declared here. Binding the application to a
hostname is a later authorized operation and cannot make the production public
Worker reachable.

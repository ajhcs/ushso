function routePairKey(from, to) {
  return [from, to].sort().join('\0');
}

export function validateJoinRoute(route) {
  const requiredStrings = ['route_id', 'from_record_id', 'to_record_id', 'entity', 'match_strategy', 'cardinality', 'compatibility_state', 'confidence'];
  for (const key of requiredStrings) if (typeof route?.[key] !== 'string' || !route[key]) throw new TypeError(`join route ${key} must be a non-empty string`);
  if (route.from_record_id === route.to_record_id) throw new TypeError(`join route ${route.route_id} cannot join a record to itself`);
  if (!Array.isArray(route.key_pairs) || route.key_pairs.length === 0) throw new TypeError(`join route ${route.route_id} requires key_pairs`);
  if (!Array.isArray(route.caveats) || route.caveats.length === 0) throw new TypeError(`join route ${route.route_id} requires caveats`);
  if (!Array.isArray(route.evidence_refs) || route.evidence_refs.length === 0) throw new TypeError(`join route ${route.route_id} requires evidence_refs`);
  if (!['documented', 'candidate', 'ambiguous', 'incompatible', 'unknown'].includes(route.compatibility_state)) throw new TypeError(`join route ${route.route_id} has invalid compatibility_state`);
  if (!['high', 'medium', 'low', 'unknown'].includes(route.confidence)) throw new TypeError(`join route ${route.route_id} has invalid confidence`);
  for (const pair of route.key_pairs) {
    if (!Array.isArray(pair.from_fields) || pair.from_fields.length === 0 || !Array.isArray(pair.to_fields) || pair.to_fields.length === 0) throw new TypeError(`join route ${route.route_id} key pair requires from_fields and to_fields`);
    if (!Array.isArray(pair.normalization_steps)) throw new TypeError(`join route ${route.route_id} key pair normalization_steps must be an array`);
  }
  return route;
}

export function selectJoinRoutes(routes, selectedRecords) {
  const selected = new Set(selectedRecords.map(record => record.record_id));
  return routes
    .filter(route => selected.has(route.from_record_id) && selected.has(route.to_record_id))
    .map(route => structuredClone(route))
    .sort((a, b) => a.route_id.localeCompare(b.route_id));
}

export function joinConnectivity(routes) {
  const pairs = new Set(routes.map(route => routePairKey(route.from_record_id, route.to_record_id)));
  return { route_count: routes.length, connected_pair_count: pairs.size };
}

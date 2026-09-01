import { assert, clone } from "./common.mjs";

export function validateAppendOnlyAccessObservations(observations) {
  const ids = new Set();
  for (const observation of observations) {
    assert(!ids.has(observation.observation_id), "Access observations are append-only and IDs cannot be reused", "duplicate_access_observation");
    ids.add(observation.observation_id);
    assert(observation.access_workflow_submitted === false, "USHSO cannot submit access workflows", "access_boundary_violation");
    assert(observation.payloads_acquired === false && observation.raw_payload_stored === false, "Access observation cannot claim payload acquisition", "payload_boundary_violation");
    assert(Number.isFinite(Date.parse(observation.clocks?.observed_at ?? observation.observed_at)), "Access observation requires a valid observed_at clock", "invalid_observation_time");
    assert(Number.isFinite(Date.parse(observation.clocks?.recorded_at ?? observation.recorded_at ?? observation.clocks?.observed_at ?? observation.observed_at)), "Access observation requires a valid recorded_at clock", "invalid_recorded_time");
  }
  return true;
}

export function deriveAccessObservation({ accessRouteId, observations, asOf }) {
  validateAppendOnlyAccessObservations(observations);
  const asOfMillis = Date.parse(asOf);
  assert(Number.isFinite(asOfMillis), "asOf must be an ISO timestamp", "invalid_time");
  const eligible = observations
    .filter((observation) => observation.access_route_id === accessRouteId
      && Date.parse(observation.clocks?.observed_at ?? observation.observed_at) <= asOfMillis
      && Date.parse(observation.clocks?.recorded_at ?? observation.recorded_at ?? observation.clocks?.observed_at ?? observation.observed_at) <= asOfMillis)
    .sort((left, right) => Date.parse(right.clocks?.observed_at ?? right.observed_at) - Date.parse(left.clocks?.observed_at ?? left.observed_at));
  if (eligible.length === 0) {
    return {
      access_route_id: accessRouteId,
      observation_id: null,
      freshness_state: "unknown",
      catalog_visibility_state: "unknown",
      payload_access_state: "unknown",
      authorization_state: "unknown",
      infrastructure_state: "unknown",
      requirement_state: "unknown",
      derived_at: asOf,
      derivation: "no_observation_at_or_before_as_of",
    };
  }
  const latest = clone(eligible[0]);
  const staleAt = latest.stale_at ? Date.parse(latest.stale_at) : Number.NaN;
  if (!Number.isFinite(staleAt)) {
    return {
      ...latest,
      freshness_state: latest.freshness_state === "not_applicable" ? "not_applicable" : "unknown",
      derived_at: asOf,
      derivation: "staleness_boundary_unknown",
    };
  }
  if (staleAt <= asOfMillis) {
    return {
      ...latest,
      freshness_state: "stale",
      catalog_visibility_state: latest.catalog_visibility_state === "excluded" ? "excluded" : "stale",
      payload_access_state: latest.payload_access_state === "excluded" ? "excluded" : "stale",
      infrastructure_state: "stale",
      derived_at: asOf,
      derivation: "stale_at_elapsed",
    };
  }
  return { ...latest, derived_at: asOf, derivation: "current_observation_before_stale_at" };
}

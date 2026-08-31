import { AUTOMATIC_GATE_FLOORS, assert } from "./common.mjs";

const NORMALIZATION_OPERATIONS = new Set([
  "trim",
  "case_fold",
  "remove_punctuation",
  "left_pad",
  "regex_replace",
  "identity",
]);

function parseRegexParameter(parameter) {
  const separator = typeof parameter === "string" ? parameter.indexOf("=>") : -1;
  assert(separator >= 0, "regex_replace parameter must be 'pattern=>replacement'", "invalid_normalization");
  return [parameter.slice(0, separator), parameter.slice(separator + 2)];
}

export function normalizeIdentifier(rawValue, namespace) {
  assert(typeof rawValue === "string" && rawValue.length > 0, "Identifier value is required", "invalid_identifier");
  const steps = [...(namespace.normalization_steps ?? [])].sort((left, right) => left.order - right.order);
  assert(steps.length > 0, "A namespace requires explicit normalization steps", "missing_normalization");
  assert(new Set(steps.map((step) => step.order)).size === steps.length, "Normalization step order must be unique", "invalid_normalization");

  let value = rawValue;
  for (const step of steps) {
    assert(NORMALIZATION_OPERATIONS.has(step.operation), `Unsupported normalization operation: ${step.operation}`, "invalid_normalization");
    if (step.operation === "trim") value = value.trim();
    if (step.operation === "case_fold") {
      value = namespace.case_behavior === "fold_lower" ? value.toLowerCase() : value.toUpperCase();
    }
    if (step.operation === "remove_punctuation") value = value.replace(/[\p{P}\p{S}\s]+/gu, "");
    if (step.operation === "left_pad") {
      const width = Number(step.parameter);
      assert(Number.isSafeInteger(width) && width > 0, "left_pad requires a positive integer width", "invalid_normalization");
      value = value.padStart(width, "0");
    }
    if (step.operation === "regex_replace") {
      const [pattern, replacement] = parseRegexParameter(step.parameter);
      value = value.replace(new RegExp(pattern, "gu"), replacement);
    }
  }
  if (namespace.case_behavior === "numeric") {
    assert(/^\d+$/.test(value), "A numeric namespace produced a non-numeric value", "check_failed");
  }
  assert(value.length > 0, "Normalization cannot produce an empty identifier", "check_failed");
  return value;
}

export function evaluateCheckRule(value, checkRule, context = {}) {
  if (!checkRule || checkRule.kind === "none") return { passed: true, reason: "no_check_rule" };
  if (checkRule.kind === "regex") {
    assert(typeof checkRule.expression === "string" && checkRule.expression.length > 0, "Regex check rule requires an expression", "invalid_check_rule");
    return { passed: new RegExp(checkRule.expression, "u").test(value), reason: "regex" };
  }
  if (checkRule.kind === "check_digit") {
    const validatorId = checkRule.expression ?? checkRule.version;
    const validator = context.checkDigitValidators?.[validatorId];
    if (typeof validator !== "function") return { passed: false, reason: "check_digit_requires_registered_validator" };
    return { passed: validator(value) === true, reason: `registered_check_digit:${validatorId}` };
  }
  const receipt = context.registryLookupReceipts?.find((item) => item.value === value && item.rule_version === checkRule.version && item.valid === true && item.receipt_id);
  return { passed: Boolean(receipt), reason: receipt ? "verified_registry_lookup_receipt" : "registry_lookup_not_performed" };
}

function completeInterval(assertion) {
  const interval = assertion.effective_interval;
  return Boolean(interval && interval.completeness === "complete" && interval.start && interval.end);
}

function intervalsOverlap(left, right) {
  return left.effective_interval.start < right.effective_interval.end && right.effective_interval.start < left.effective_interval.end;
}

export function assessBenchmarkGate(gate) {
  const reasons = [];
  if (!gate || gate.state !== "enabled") reasons.push("gate_not_enabled");
  if (!gate?.sealed_benchmark_id) reasons.push("benchmark_not_sealed");
  if (!gate?.enablement_receipt_id) reasons.push("enablement_receipt_missing");
  for (const [metric, floor] of Object.entries(AUTOMATIC_GATE_FLOORS)) {
    const actual = gate?.[metric];
    if (metric === "false_automatic_merges") {
      if (actual !== floor) reasons.push("false_automatic_merges_nonzero_or_unmeasured");
    } else if (typeof actual !== "number" || actual < floor) {
      reasons.push(`${metric}_below_floor`);
    }
  }
  return { eligible: reasons.length === 0, reasons };
}

function conflictingAssertionIds(left, right, assertions, namespace) {
  return assertions.filter((other) => {
    if (other.state !== "active" || other.namespace_id !== namespace.namespace_id) return false;
    if (other.authority_class !== "authoritative") return false;
    if (other.object_id !== left.object_id && other.object_id !== right.object_id) return false;
    if (other.normalized_value === left.normalized_value) return false;
    if (!completeInterval(other)) return true;
    const relevant = other.object_id === left.object_id ? left : right;
    return completeInterval(relevant) && intervalsOverlap(other, relevant);
  }).map((other) => other.assertion_id).sort((a, b) => a.localeCompare(b));
}

export function evaluateExactIdentifierPair({ left, right, namespace, activeAssertions = [], authorizedEnablementReceiptIds = [], checkRuleContext = {} }) {
  const reasons = [];
  const checks = {};
  checks.different_objects = left.object_id !== right.object_id;
  checks.same_namespace = left.namespace_id === right.namespace_id && left.namespace_id === namespace.namespace_id;
  checks.normalized_values_match = left.normalized_value === right.normalized_value;
  try {
    checks.normalization_verified = normalizeIdentifier(left.raw_value, namespace) === left.normalized_value
      && normalizeIdentifier(right.raw_value, namespace) === right.normalized_value;
    checks.registered_check_rule_passed = evaluateCheckRule(left.normalized_value, namespace.check_rule, checkRuleContext).passed
      && evaluateCheckRule(right.normalized_value, namespace.check_rule, checkRuleContext).passed;
  } catch {
    checks.normalization_verified = false;
    checks.registered_check_rule_passed = false;
  }
  checks.check_passed = left.check_passed === true && right.check_passed === true;
  checks.active_assertions = left.state === "active" && right.state === "active";
  checks.entity_type_compatible = left.entity_type === right.entity_type && namespace.entity_types.includes(left.entity_type);
  checks.grain_compatible = left.grain === right.grain && namespace.grains.includes(left.grain);
  checks.complete_intervals = completeInterval(left) && completeInterval(right);
  checks.intervals_overlap = checks.complete_intervals && intervalsOverlap(left, right);
  checks.uniqueness_known = namespace.uniqueness_policy === "unique_within_effective_period";
  checks.reuse_safe = namespace.reuse_policy === "prohibited";
  checks.authority_eligible = namespace.scope.kind === "cross_source_authoritative"
    ? left.authority_class === "authoritative" && right.authority_class === "authoritative"
    : ["authoritative", "source_native"].includes(left.authority_class) && ["authoritative", "source_native"].includes(right.authority_class);
  checks.source_scope_eligible = namespace.scope.kind === "cross_source_authoritative"
    ? true
    : namespace.scope.kind === "source_local" && left.source_id === right.source_id && left.source_id === namespace.scope.source_id;
  const conflictIds = conflictingAssertionIds(left, right, activeAssertions, namespace);
  checks.no_authoritative_conflict = conflictIds.length === 0;
  const gate = assessBenchmarkGate(namespace.benchmark_gate);
  checks.benchmark_gate = gate.eligible;
  checks.enablement_receipt_authorized = Boolean(namespace.benchmark_gate?.enablement_receipt_id)
    && authorizedEnablementReceiptIds.includes(namespace.benchmark_gate.enablement_receipt_id);

  for (const [name, passed] of Object.entries(checks)) {
    if (!passed && name !== "benchmark_gate") reasons.push(name);
  }
  if (!checks.benchmark_gate) reasons.push(...gate.reasons);
  if (namespace.reuse_policy !== "prohibited") reasons.push("identifier_reuse_not_prohibited");
  if (!checks.complete_intervals) reasons.push("effective_dates_incomplete");
  if (checks.complete_intervals && !checks.intervals_overlap) reasons.push("effective_periods_do_not_overlap");

  const uniqueReasons = [...new Set(reasons)];
  return {
    eligible: uniqueReasons.length === 0,
    disposition: uniqueReasons.length === 0 ? "automatic_exact_policy" : "candidate_only",
    state: uniqueReasons.length === 0 ? "accepted" : "open",
    checks,
    reasons: uniqueReasons,
    conflicting_assertion_ids: conflictIds,
    enablement_receipt_id: uniqueReasons.length === 0 ? namespace.benchmark_gate.enablement_receipt_id : null,
  };
}

#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJson, repositoryRoot, stableJson } from "./paths.mjs";

function compilePatterns(policy) {
  return policy.sensitive_key_patterns.map(
    (pattern) => new RegExp(`(^|[_-])${pattern.replaceAll("_", "[_-]")}($|[_-])`, "i")
  );
}

export function redactTerraformPlan(input, policy) {
  const patterns = compilePatterns(policy);
  const replacement = policy.replacement;

  function visit(value, key = "") {
    if (patterns.some((pattern) => pattern.test(key))) {
      return replacement;
    }
    if (Array.isArray(value)) {
      return value.map((item) => visit(item));
    }
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([childKey, childValue]) => [
          childKey,
          visit(childValue, childKey)
        ])
      );
    }
    if (
      typeof value === "string" &&
      (/\b(?:postgres(?:ql)?|mysql):\/\/[^\s/@:]+:[^\s/@]+@/i.test(value) ||
        /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(value))
    ) {
      return replacement;
    }
    return value;
  }

  return visit(structuredClone(input));
}

export function assertRedactedPlanSafe(value) {
  const text = JSON.stringify(value);
  if (/\b(?:postgres(?:ql)?|mysql):\/\/[^\s/@:]+:[^\s/@]+@/i.test(text)) {
    throw new Error("redacted plan still contains URI credentials");
  }
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) {
    throw new Error("redacted plan still contains a private key");
  }
  if (/\b(?:sk_live|sk_test|ghp|xox[baprs])-[-A-Za-z0-9_]{16,}\b/.test(text)) {
    throw new Error("redacted plan still contains a known token form");
  }
}

function main() {
  const [inputFile, outputFile] = process.argv.slice(2);
  if (!inputFile || !outputFile) {
    throw new Error("usage: redact-plan.mjs INPUT_PLAN_JSON OUTPUT_REDACTED_JSON");
  }
  if (path.resolve(inputFile) === path.resolve(outputFile)) {
    throw new Error("refusing to overwrite the unredacted apply artifact");
  }
  const root = repositoryRoot(import.meta.url);
  const policy = readJson(path.join(root, "infra", "policy", "plan-redaction.v1.0.0.json"));
  const redacted = redactTerraformPlan(readJson(inputFile), policy);
  assertRedactedPlanSafe(redacted);
  fs.writeFileSync(outputFile, stableJson(redacted), { encoding: "utf8", mode: 0o600, flag: "wx" });
  process.stdout.write(`wrote redacted review artifact ${outputFile}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

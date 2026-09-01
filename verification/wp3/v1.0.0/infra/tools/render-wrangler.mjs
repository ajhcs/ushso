#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJson, repositoryRoot, stableJson } from "./paths.mjs";

const PRODUCER_BINDINGS = {
  HARVEST_PAGE_QUEUE: "harvest-page",
  NORMALIZE_RECORD_QUEUE: "normalize-record",
  ENRICH_SCHEMA_QUEUE: "enrich-schema",
  ACCESS_CHECK_QUEUE: "access-check",
  PROJECT_INDEX_QUEUE: "project-index"
};

function queueByLogicalName(resources, logicalName) {
  return resources.queues.find(
    (queue) => queue.name === logicalName || queue.dead_letter_queue === logicalName
  );
}

function queueConsumer(resources, queueContract, prefix, logicalName) {
  const queue = queueByLogicalName(resources, logicalName);
  assert(queue, `unknown queue consumer ${logicalName}`);
  if (queue.dead_letter_queue === logicalName) {
    const sink = queueContract.dlq_sink;
    assert(sink.applies_to.includes(logicalName), `DLQ sink policy missing ${logicalName}`);
    assert.equal(sink.second_dead_letter_queue, null, "recursive DLQ is prohibited");
    return {
      queue: `${prefix}-${logicalName}`,
      max_batch_size: sink.max_batch_size,
      max_batch_timeout: sink.max_batch_timeout_seconds,
      max_retries: sink.transport_max_retries,
      max_concurrency: sink.max_concurrency,
      retry_delay: sink.wrangler_default_retry_delay_seconds
    };
  }
  return {
    queue: `${prefix}-${queue.name}`,
    max_batch_size: queue.max_batch_size,
    max_batch_timeout: queue.max_batch_timeout_seconds,
    max_retries: queue.transport_max_retries,
    dead_letter_queue: `${prefix}-${queue.dead_letter_queue}`,
    max_concurrency: queue.max_concurrency
  };
}

export function renderEnvironment(root, environment) {
  const manifestDir = path.join(root, "infra", "cloudflare", "manifests");
  const resources = readJson(path.join(manifestDir, `resources.${environment}.json`));
  const bindingContract = readJson(path.join(manifestDir, "worker-bindings.json"));
  const queueContract = readJson(path.join(manifestDir, "queue-workflow-contract.json"));
  assert.equal(resources.environment, environment);

  const hyperdrive = new Map(
    resources.hyperdrive_configs.map((item) => [`${item.worker_role}:${item.binding}`, item])
  );
  const r2 = new Map(resources.r2_buckets.map((item) => [item.binding, item]));
  const prefix = resources.resource_prefix;
  const result = new Map();

  for (const worker of bindingContract.workers) {
    const config = {
      $schema: "../../../../node_modules/wrangler/config-schema.json",
      name: `${prefix}-${worker.name_suffix}`,
      main: "../../templates/foundation-placeholder.mjs",
      compatibility_date: "2026-08-30",
      compatibility_flags: ["nodejs_compat_v2"],
      workers_dev: false,
      routes: [],
      vars: {
        USHSO_ENVIRONMENT: environment,
        USHSO_WORKER_ROLE: worker.role,
        FOUNDATION_INERT: "true",
        CONFIG_SCHEMA_VERSION: "ushso-worker-binding-manifest.v1.0.0"
      },
      observability: {
        enabled: true,
        logs: { enabled: true, head_sampling_rate: environment === "production" ? 0.1 : 0.25, invocation_logs: true },
        traces: { enabled: true, head_sampling_rate: environment === "production" ? 0.05 : 0.1 }
      }
    };

    if (worker.hyperdrive.length > 0) {
      config.hyperdrive = worker.hyperdrive.map((binding) => {
        const resource = hyperdrive.get(`${worker.role}:${binding}`);
        assert(resource, `unknown Hyperdrive binding ${binding}`);
        return { binding, id: resource.id_placeholder };
      });
    }

    if (worker.r2.length > 0) {
      config.r2_buckets = worker.r2.map((binding) => {
        const resource = r2.get(binding);
        assert(resource, `unknown R2 binding ${binding}`);
        return { binding, bucket_name: resource.name };
      });
    }

    const producers = worker.queue_producers.map((binding) => ({
      binding,
      queue: `${prefix}-${PRODUCER_BINDINGS[binding]}`
    }));
    const consumers = worker.queue_consumers.map((logicalName) =>
      queueConsumer(resources, queueContract, prefix, logicalName)
    );
    if (producers.length > 0 || consumers.length > 0) {
      config.queues = { producers, consumers };
    }

    if (worker.workflows.length > 0) {
      config.workflows = worker.workflows.map((binding) => {
        assert.equal(binding, resources.workflow.binding);
        const value = {
          binding,
          name: resources.workflow.name,
          class_name: resources.workflow.class_name
        };
        if (worker.role === "scheduler") {
          value.concurrency = { limit: resources.workflow.concurrency_limit };
          value.default_retention = {
            success_retention: resources.workflow.success_retention,
            error_retention: resources.workflow.error_retention
          };
        } else {
          value.script_name = `${prefix}-scheduler`;
        }
        return value;
      });
    }

    if (worker.cron.length > 0) {
      config.triggers = { crons: [...worker.cron] };
    }

    result.set(worker.role, config);
  }
  return result;
}

export function expectedRenderedFiles(root) {
  const files = new Map();
  for (const environment of ["staging", "production"]) {
    for (const [role, config] of renderEnvironment(root, environment)) {
      files.set(
        path.join(root, "infra", "cloudflare", "rendered", environment, `${role}.wrangler.json`),
        stableJson(config)
      );
    }
  }
  return files;
}

export function checkRendered(root) {
  const differences = [];
  for (const [file, expected] of expectedRenderedFiles(root)) {
    if (!fs.existsSync(file)) {
      differences.push(`${path.relative(root, file)} is missing`);
    } else if (fs.readFileSync(file, "utf8") !== expected) {
      differences.push(`${path.relative(root, file)} is stale`);
    }
  }
  return differences;
}

function main() {
  const root = repositoryRoot(import.meta.url);
  const mode = process.argv[2] ?? "--check";
  if (mode === "--write") {
    for (const [file, content] of expectedRenderedFiles(root)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content, "utf8");
    }
    process.stdout.write("rendered 12 zero-traffic Wrangler configurations\n");
    return;
  }
  if (mode !== "--check") {
    throw new Error("usage: render-wrangler.mjs [--check|--write]");
  }
  const differences = checkRendered(root);
  if (differences.length > 0) {
    throw new Error(differences.join("\n"));
  }
  process.stdout.write("PASS rendered Wrangler configs are deterministic and current (12/12)\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

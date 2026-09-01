// This fail-closed module exists only so the rendered Wrangler configuration can
// be bundled and schema-checked offline. It is not a USHSO Worker implementation
// and must never be deployed. Real entrypoints are introduced by their owning
// workstreams after binding-contract tests pass.

export class HarvestWorkflow {
  async run() {
    throw new Error("WP3 foundation placeholder cannot execute a Workflow");
  }
}

export default {
  async fetch() {
    return Response.json(
      { error: "foundation_placeholder", traffic_enabled: false },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  },
  async scheduled() {
    // Deliberately inert if an operator violates the no-deploy rule.
  },
  async queue(batch) {
    // Never acknowledge work from an accidentally attached live queue.
    batch.retryAll();
  }
};

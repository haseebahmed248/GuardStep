// @ts-check

/** @satisfies {import("./decide.generated.js").GuardStepHost} */
const host = {
  schemaVersion: 1,
  workflow: "Decide",
  grantedCapabilities: ["echo"],
  pricing: {
    currency: "USD",
    input_usd_per_million: 0,
    output_usd_per_million: 0,
    source: "keyless-branch-demo",
    effective_date: "2026-09-07",
  },
  tools: {
    async invoke({ arguments: args }) {
      return { status: "succeeded", value: { text: `[tool] ${args.text}` }, elapsedMs: 0 };
    },
  },
  model: {
    async generate({ context }) {
      // This is a deterministic fixture, not an external LLM request.
      return {
        status: "succeeded", value: { text: `[mock model] ${context.text}` },
        usage: { input_tokens: 0, output_tokens: 0 }, elapsedMs: 0,
      };
    },
  },
};

export default host;

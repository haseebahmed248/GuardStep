import host from "./decide.host.mjs";

const cases = [
  { id: "empty-fails", text: "", grants: [], output: undefined, errorCode: "EMPTY", effects: [] },
  { id: "cached-returns-without-effects", text: "cached", grants: [], output: "cached", effects: [] },
  { id: "local-model-only", text: "local", grants: [], output: "[mock model] local", effects: ["model.started", "model.succeeded"] },
  { id: "tool-then-model", text: "hello", grants: ["echo"], output: "[mock model] [tool] hello", effects: ["capability.checked", "tool.started", "tool.succeeded", "model.started", "model.succeeded"] },
  { id: "selected-tool-denied", text: "hello", grants: [], errorCode: "DENIED", effects: ["capability.checked"] },
];

export default {
  schemaVersion: 1,
  workflow: "Decide",
  cases: cases.map(({ id, text, grants, output, errorCode, effects }) => ({
    id, input: { text }, grantedCapabilities: grants,
    pricing: host.pricing, tools: host.tools, model: host.model,
    expect: {
      status: errorCode === undefined ? "succeeded" : "failed",
      ...(errorCode === undefined ? { output: { text: output } } : { errorCode }),
      eventTypes: ["run.started", ...effects, errorCode === undefined ? "run.succeeded" : "run.failed"],
    },
  })),
};

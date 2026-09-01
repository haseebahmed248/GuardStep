import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";

import { compileSource } from "../compiler/index.js";
import {
  executeWorkflow,
  RuntimeConfigurationError,
  RuntimeInputError,
} from "../runtime/index.js";

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const sourcePath = `${repositoryRoot}examples/document-qa/answer.guard`;
const ir = compileSource({ source: readFileSync(sourcePath, "utf8"), sourcePath });
const pricing = {
  currency: "USD",
  input_usd_per_million: 1,
  output_usd_per_million: 2,
  source: "unit-test",
  effective_date: "2026-08-31",
};

test("rejects invalid public input before emitting workflow events", async () => {
  await assert.rejects(
    executeWorkflow({
      ir,
      workflow: "AnswerQuestion",
      runId: "invalid-input",
      input: { wrong: "field" },
      grantedCapabilities: new Set(["documents.search"]),
      pricing,
      tools: { invoke: async () => assert.fail("tool must not run") },
      model: { generate: async () => assert.fail("model must not run") },
    }),
    RuntimeInputError,
  );
});

test("denies authority before invoking a protected tool", async () => {
  let toolCalls = 0;
  const run = await executeWorkflow({
    ir,
    workflow: "AnswerQuestion",
    runId: "denied",
    input: { question: "test" },
    grantedCapabilities: new Set(),
    pricing,
    tools: {
      async invoke() {
        toolCalls += 1;
        return { status: "succeeded", value: [], elapsedMs: 0 };
      },
    },
    model: { generate: async () => assert.fail("model must not run") },
  });

  assert.equal(run.status, "failed");
  assert.equal(run.status === "failed" ? run.error_code : undefined, "CAPABILITY_DENIED");
  assert.equal(toolCalls, 0);
  assert.deepEqual(run.events.map(({ type }) => type), [
    "run.started",
    "capability.checked",
    "run.failed",
  ]);
});

test("rejects mismatched pricing before emitting effects", async () => {
  await assert.rejects(
    executeWorkflow({
      ir,
      workflow: "AnswerQuestion",
      runId: "wrong-currency",
      input: { question: "test" },
      grantedCapabilities: new Set(["documents.search"]),
      pricing: { ...pricing, currency: "EUR" },
      tools: { invoke: async () => assert.fail("tool must not run") },
      model: { generate: async () => assert.fail("model must not run") },
    }),
    RuntimeConfigurationError,
  );
});

test("maps invalid tool output to the workflow's declared failure", async () => {
  const run = await executeWorkflow({
    ir,
    workflow: "AnswerQuestion",
    runId: "invalid-tool-output",
    input: { question: "test" },
    grantedCapabilities: new Set(["documents.search"]),
    pricing,
    tools: {
      invoke: async () => ({ status: "succeeded", value: [{ unexpected: true }], elapsedMs: 1 }),
    },
    model: { generate: async () => assert.fail("model must not run") },
  });

  assert.equal(run.status, "failed");
  assert.equal(run.status === "failed" ? run.error_code : undefined, "TOOL_OUTPUT_INVALID");
  assert.deepEqual(run.events.map(({ type }) => type), [
    "run.started",
    "capability.checked",
    "tool.started",
    "tool.failed",
    "run.failed",
  ]);
});

test("does not let an adapter choose a public workflow failure code", async () => {
  const run = await executeWorkflow({
    ir,
    workflow: "AnswerQuestion",
    runId: "tool-adapter-error",
    input: { question: "test" },
    grantedCapabilities: new Set(["documents.search"]),
    pricing,
    tools: {
      invoke: async () => ({
        status: "failed",
        kind: "error",
        code: "ADAPTER_CONTROLLED_CODE",
        elapsedMs: 1,
      }),
    },
    model: { generate: async () => assert.fail("model must not run") },
  });

  assert.equal(run.status, "failed");
  assert.equal(run.status === "failed" ? run.error_code : undefined, "TOOL_CALL_FAILED");
});

test("converts thrown adapter errors into declared workflow failures", async () => {
  const run = await executeWorkflow({
    ir,
    workflow: "AnswerQuestion",
    runId: "tool-adapter-throw",
    input: { question: "test" },
    grantedCapabilities: new Set(["documents.search"]),
    pricing,
    tools: {
      invoke: async () => {
        throw new Error("secret adapter detail");
      },
    },
    model: { generate: async () => assert.fail("model must not run") },
  });

  assert.equal(run.status, "failed");
  assert.equal(run.status === "failed" ? run.error_code : undefined, "TOOL_CALL_FAILED");
  assert.doesNotMatch(JSON.stringify(run.events), /secret adapter detail/);
});

test("passes only declared context and generated schema to the model", async () => {
  const requests: unknown[] = [];
  const answer = {
    status: "insufficient_context",
    text: "No supporting context.",
    citations: [],
  };
  const run = await executeWorkflow({
    ir,
    workflow: "AnswerQuestion",
    runId: "context",
    input: { question: "unknown" },
    grantedCapabilities: new Set(["documents.search"]),
    pricing,
    tools: {
      invoke: async () => ({
        status: "succeeded",
        value: [],
        elapsedMs: 1,
        eventData: { document_ids: [] },
      }),
    },
    model: {
      async generate(request) {
        requests.push(request);
        return {
          status: "succeeded",
          value: answer,
          usage: { input_tokens: 10, output_tokens: 10 },
          elapsedMs: 1,
        };
      },
    },
  });

  assert.equal(run.status, "succeeded");
  assert.equal(requests.length, 1);
  const request = requests[0] as { context: unknown; outputSchema: { $ref?: string } };
  assert.deepEqual(request.context, { question: "unknown", documents: [] });
  assert.equal(request.outputSchema.$ref, "#/$defs/Answer");
});

test("maps invalid model output to the workflow's declared failure", async () => {
  const run = await executeWorkflow({
    ir,
    workflow: "AnswerQuestion",
    runId: "invalid-model-output",
    input: { question: "test" },
    grantedCapabilities: new Set(["documents.search"]),
    pricing,
    tools: {
      invoke: async () => ({ status: "succeeded", value: [], elapsedMs: 1 }),
    },
    model: {
      generate: async () => ({
        status: "succeeded",
        value: "not structured JSON",
        usage: { input_tokens: 10, output_tokens: 3 },
        elapsedMs: 1,
      }),
    },
  });

  assert.equal(run.status, "failed");
  assert.equal(run.status === "failed" ? run.error_code : undefined, "MODEL_OUTPUT_INVALID");
  assert.deepEqual(run.events.map(({ type }) => type), [
    "run.started",
    "capability.checked",
    "tool.started",
    "tool.succeeded",
    "model.started",
    "model.failed",
    "run.failed",
  ]);
});

test("does not let a model provider choose a public workflow failure code", async () => {
  const run = await executeWorkflow({
    ir,
    workflow: "AnswerQuestion",
    runId: "model-provider-error",
    input: { question: "test" },
    grantedCapabilities: new Set(["documents.search"]),
    pricing,
    tools: {
      invoke: async () => ({ status: "succeeded", value: [], elapsedMs: 1 }),
    },
    model: {
      generate: async () => ({
        status: "failed",
        code: "PROVIDER_CONTROLLED_CODE",
        elapsedMs: 1,
      }),
    },
  });

  assert.equal(run.status, "failed");
  assert.equal(run.status === "failed" ? run.error_code : undefined, "MODEL_CALL_FAILED");
  assert.doesNotMatch(JSON.stringify(run.events), /PROVIDER_CONTROLLED_CODE/);
});

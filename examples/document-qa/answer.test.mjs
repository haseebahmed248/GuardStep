import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const loadJson = (relativePath) =>
  JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8"));

const corpus = loadJson("../../benchmarks/document-qa/fixtures/documents.json");
const fixture = loadJson("../../benchmarks/document-qa/fixtures/scenarios.json");
const eventSchema = loadJson("../../schemas/execution-event.v1.schema.json");
const documentById = new Map(corpus.documents.map((document) => [document.id, document]));

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateEvent = ajv.compile(eventSchema);

const expectedInstructions = [
  "Answer the question using only the supplied documents.",
  "Return status 'answered' only when the documents support an answer.",
  "Return status 'insufficient_context' when the documents do not support an answer.",
  "For an answered result, copy every citation ID, title, and URL from a supplied document.",
  "Return a value that matches the supplied JSON Schema.",
].join("\n");

const createCase = (scenario) => {
  const toolInvocations = [];
  const modelInvocations = [];
  const tools = {
    async invoke(request) {
      toolInvocations.push(request);
      if (request.tool !== "documents.search") {
        return { status: "failed", kind: "error", code: "UNEXPECTED_TOOL", elapsedMs: 0 };
      }
      if (scenario.search.behavior === "timeout") {
        return { status: "failed", kind: "timeout", elapsedMs: scenario.search.elapsed_ms };
      }
      const documents = scenario.search.document_ids.map((id) => {
        const document = documentById.get(id);
        if (document === undefined) throw new Error(`Unknown fixture document: ${id}`);
        return document;
      });
      return {
        status: "succeeded",
        value: documents,
        elapsedMs: scenario.search.elapsed_ms,
        eventData: { document_ids: scenario.search.document_ids },
      };
    },
  };
  const model = {
    async generate(request) {
      modelInvocations.push(request);
      if (scenario.model.behavior === "not_reached") {
        throw new Error(`Model must not be reached for ${scenario.id}`);
      }
      return {
        status: "succeeded",
        value: scenario.model.output,
        usage: scenario.model.usage,
        elapsedMs: scenario.model.elapsed_ms,
      };
    },
  };

  return {
    id: scenario.id,
    input: scenario.input,
    grantedCapabilities: scenario.granted_capabilities,
    pricing: fixture.pricing,
    tools,
    model,
    expect: {
      status: scenario.expect.status,
      ...(scenario.expect.error_code === undefined ? {} : { errorCode: scenario.expect.error_code }),
      ...(scenario.expect.status === "succeeded" ? { output: scenario.model.output } : {}),
      eventTypes: scenario.expect.required_events,
    },
    verify(run) {
      const failures = [];
      const eventTypes = run.events.map(({ type }) => type);
      const expectedToolCalls = eventTypes.includes("tool.started") ? 1 : 0;
      const expectedModelCalls = eventTypes.includes("model.started") ? 1 : 0;
      if (toolInvocations.length !== expectedToolCalls) {
        failures.push(`expected ${expectedToolCalls} tool call(s), received ${toolInvocations.length}`);
      }
      if (modelInvocations.length !== expectedModelCalls) {
        failures.push(`expected ${expectedModelCalls} model call(s), received ${modelInvocations.length}`);
      }
      if (toolInvocations.some(({ arguments: args }) => args.question !== scenario.input.question)) {
        failures.push("documents.search received a modified question");
      }
      if (modelInvocations.length === 1 && scenario.search.behavior === "return") {
        const request = modelInvocations[0];
        if (request.instructions !== expectedInstructions) failures.push("model instructions changed");
        if (request.context.question !== scenario.input.question) failures.push("model question changed");
        const documentIds = request.context.documents.map(({ id }) => id);
        if (!isDeepStrictEqual(documentIds, scenario.search.document_ids)) {
          failures.push("model did not receive retrieved documents in fixture order");
        }
        if (request.outputSchema.$ref !== "#/$defs/Answer") {
          failures.push("model did not receive the generated Answer schema");
        }
      }
      for (const [index, event] of run.events.entries()) {
        if (!validateEvent(event)) failures.push(`event ${index} violates execution-event.v1`);
        if (event.sequence !== index) failures.push(`event ${index} has a non-dense sequence`);
        if (event.run_id !== `AnswerQuestion/${scenario.id}`) failures.push(`event ${index} has wrong run_id`);
      }
      const serializedEvents = JSON.stringify(run.events);
      for (const document of corpus.documents) {
        if (serializedEvents.includes(document.content)) {
          failures.push(`events expose content from ${document.id}`);
        }
      }
      return failures;
    },
  };
};

export default {
  schemaVersion: 1,
  workflow: "AnswerQuestion",
  cases: fixture.scenarios.map(createCase),
};

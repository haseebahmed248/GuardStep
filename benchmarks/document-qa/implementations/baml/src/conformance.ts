import { isDeepStrictEqual } from "node:util";

import { FixtureBamlModelAdapter, FixtureSearchAdapter } from "./adapters.js";
import { validateEvent, validateInput, validateOutput } from "./contracts.js";
import { executeDocumentQa } from "./workflow.js";
import type {
  CorpusFixture,
  Document,
  Scenario,
  ScenarioFixture,
  WorkflowRun,
} from "./types.js";

export interface ScenarioExecution {
  scenario: Scenario;
  run: WorkflowRun;
  searchAdapter: FixtureSearchAdapter;
  modelAdapter: FixtureBamlModelAdapter;
}

export interface ConformanceResult {
  execution: ScenarioExecution;
  failures: string[];
}

export const runScenario = async (
  scenario: Scenario,
  corpus: CorpusFixture,
  fixture: ScenarioFixture,
): Promise<ScenarioExecution> => {
  const inputValidation = validateInput(scenario.input);
  if (!inputValidation.valid || inputValidation.value === undefined) {
    throw new Error(`Scenario ${scenario.id} has invalid public input`);
  }

  const documents = new Map<string, Document>(
    corpus.documents.map((document) => [document.id, document]),
  );
  const searchAdapter = new FixtureSearchAdapter(scenario, documents);
  const modelAdapter = new FixtureBamlModelAdapter(scenario);

  const run = await executeDocumentQa({
    runId: `document-qa/${scenario.id}`,
    input: inputValidation.value,
    grantedCapabilities: new Set(scenario.granted_capabilities),
    budgets: fixture.budgets,
    pricing: fixture.pricing,
    search: searchAdapter,
    model: modelAdapter,
  });

  return { scenario, run, searchAdapter, modelAdapter };
};

export const checkConformance = (execution: ScenarioExecution): string[] => {
  const { scenario, run, searchAdapter, modelAdapter } = execution;
  const failures: string[] = [];
  const expected = scenario.expect;

  if (run.status !== expected.status) {
    failures.push(`expected status ${expected.status}, received ${run.status}`);
  } else if (run.status === "failed" && expected.status === "failed") {
    if (run.error_code !== expected.error_code) {
      failures.push(`expected error ${expected.error_code}, received ${run.error_code}`);
    }
  } else if (run.status === "succeeded" && scenario.model.behavior === "return") {
    if (!isDeepStrictEqual(run.output, scenario.model.output)) {
      failures.push("successful output differs from model.output");
    }
    if (!validateOutput(run.output).valid) {
      failures.push("successful output does not match output.schema.json");
    }
  }

  const eventTypes = run.events.map((event) => event.type);
  if (!isDeepStrictEqual(eventTypes, expected.required_events)) {
    failures.push(
      `event sequence differs: expected ${expected.required_events.join(", ")}; received ${eventTypes.join(", ")}`,
    );
  }

  for (const [index, event] of run.events.entries()) {
    if (!validateEvent(event).valid) {
      failures.push(`event ${index} does not match execution-event.v1.schema.json`);
    }
    if (event.sequence !== index) {
      failures.push(`event ${index} has sequence ${event.sequence}`);
    }
    if (event.run_id !== `document-qa/${scenario.id}`) {
      failures.push(`event ${index} has the wrong run_id`);
    }
  }

  const expectedSearchCalls = eventTypes.includes("tool.started") ? 1 : 0;
  if (searchAdapter.questions.length !== expectedSearchCalls) {
    failures.push(
      `expected ${expectedSearchCalls} search call(s), received ${searchAdapter.questions.length}`,
    );
  }
  if (searchAdapter.questions.some((question) => question !== scenario.input.question)) {
    failures.push("search received a modified question");
  }

  const expectedModelCalls = eventTypes.includes("model.started") ? 1 : 0;
  if (modelAdapter.requests.length !== expectedModelCalls) {
    failures.push(
      `expected ${expectedModelCalls} model call(s), received ${modelAdapter.requests.length}`,
    );
  }

  if (modelAdapter.requests.length === 1 && scenario.search.behavior === "return") {
    const request = modelAdapter.requests[0];
    if (request?.function_name !== "AnswerQuestion") {
      failures.push("model adapter did not invoke the BAML AnswerQuestion function");
    }
    if (request === undefined || request.question !== scenario.input.question) {
      failures.push("model received a modified question");
    }
    const requestedDocumentIds = request?.documents.map((document) => document.id) ?? [];
    if (!isDeepStrictEqual(requestedDocumentIds, scenario.search.document_ids)) {
      failures.push("model did not receive the complete retrieved document set in fixture order");
    }
  }

  const serializedEvents = JSON.stringify(run.events);
  for (const document of execution.searchAdapter.documents.values()) {
    if (serializedEvents.includes(document.content)) {
      failures.push(`events expose content from document ${document.id}`);
    }
  }

  return failures;
};

export const runConformanceSuite = async (
  corpus: CorpusFixture,
  fixture: ScenarioFixture,
): Promise<ConformanceResult[]> =>
  Promise.all(
    fixture.scenarios.map(async (scenario) => {
      const execution = await runScenario(scenario, corpus, fixture);
      return { execution, failures: checkConformance(execution) };
    }),
  );

import { outputSchema, validateOutput } from "./contracts.js";
import { EventRecorder } from "./events.js";
import { createModelRequest } from "./prompt.js";
import type {
  Answer,
  Budgets,
  Capability,
  Citation,
  Document,
  FailedRun,
  FailureCode,
  ModelAdapter,
  Pricing,
  QuestionInput,
  SearchAdapter,
  Usage,
  WorkflowRun,
} from "./types.js";

export interface ExecuteDocumentQaOptions {
  runId: string;
  input: QuestionInput;
  grantedCapabilities: ReadonlySet<Capability>;
  budgets: Budgets;
  pricing: Pricing;
  search: SearchAdapter;
  model: ModelAdapter;
}

const calculateCost = (usage: Usage, pricing: Pricing): number =>
  (usage.input_tokens * pricing.input_usd_per_million) / 1_000_000 +
  (usage.output_tokens * pricing.output_usd_per_million) / 1_000_000;

const citationMatches = (
  citation: Citation,
  retrievedDocuments: ReadonlyMap<string, Document>,
): boolean => {
  const document = retrievedDocuments.get(citation.document_id);
  return document !== undefined && document.title === citation.title && document.url === citation.url;
};

export const executeDocumentQa = async (
  options: ExecuteDocumentQaOptions,
): Promise<WorkflowRun> => {
  const events = new EventRecorder(options.runId);
  let elapsedMs = 0;
  let toolCalls = 0;
  let modelCalls = 0;
  let modelCost = 0;

  const fail = (errorCode: FailureCode): FailedRun => {
    events.emit("run.failed", { error_code: errorCode });
    return {
      status: "failed",
      error_code: errorCode,
      events: events.snapshot(),
    };
  };

  const failAssertion = (errorCode: FailureCode): FailedRun => {
    events.emit("assertion.failed", { error_code: errorCode }, "assertion:citations");
    return fail(errorCode);
  };

  const failBudget = (
    errorCode: "COST_LIMIT_EXCEEDED" | "DURATION_LIMIT_EXCEEDED",
    actual: number,
    maximum: number,
    unit: "USD" | "ms",
  ): FailedRun => {
    events.emit(
      "budget.exceeded",
      { error_code: errorCode, actual, maximum, unit },
      errorCode === "COST_LIMIT_EXCEEDED" ? "budget:cost" : "budget:duration",
    );
    return fail(errorCode);
  };

  events.emit("run.started", { workflow: "AnswerQuestion" });

  const capability: Capability = "documents.search";
  const capabilityGranted = options.grantedCapabilities.has(capability);
  events.emit(
    "capability.checked",
    { capability, granted: capabilityGranted },
    "capability:documents.search",
  );
  if (!capabilityGranted) return fail("CAPABILITY_DENIED");

  if (toolCalls >= options.budgets.tool_calls) {
    throw new Error("Tool-call budget prevents the benchmark's required search call");
  }

  toolCalls += 1;
  events.emit(
    "tool.started",
    { tool: "documents.search", call: toolCalls },
    "tool:documents.search",
  );
  const searchResult = await options.search.search(options.input.question);
  elapsedMs += searchResult.elapsed_ms;

  if (searchResult.status === "failed") {
    events.emit(
      "tool.failed",
      { tool: "documents.search", error_code: searchResult.code, elapsed_ms: searchResult.elapsed_ms },
      "tool:documents.search",
    );
    return fail(searchResult.code);
  }

  events.emit(
    "tool.succeeded",
    {
      tool: "documents.search",
      document_ids: searchResult.documents.map((document) => document.id),
      elapsed_ms: searchResult.elapsed_ms,
    },
    "tool:documents.search",
  );

  if (elapsedMs > options.budgets.duration_ms) {
    return failBudget(
      "DURATION_LIMIT_EXCEEDED",
      elapsedMs,
      options.budgets.duration_ms,
      "ms",
    );
  }

  if (modelCalls >= options.budgets.model_calls) {
    throw new Error("Model-call budget prevents the benchmark's required generation call");
  }

  modelCalls += 1;
  events.emit("model.started", { profile: "balanced", call: modelCalls }, "model:balanced");
  const modelResult = await options.model.generate(
    createModelRequest(options.input, searchResult.documents, outputSchema),
  );
  elapsedMs += modelResult.elapsed_ms;
  modelCost = calculateCost(modelResult.usage, options.pricing);

  const outputValidation = validateOutput(modelResult.output);
  if (!outputValidation.valid || outputValidation.value === undefined) {
    events.emit(
      "model.failed",
      {
        error_code: "MODEL_OUTPUT_INVALID",
        issue_count: outputValidation.errors.length,
        elapsed_ms: modelResult.elapsed_ms,
      },
      "model:balanced",
    );
    return fail("MODEL_OUTPUT_INVALID");
  }

  const answer: Answer = outputValidation.value;
  events.emit(
    "model.succeeded",
    {
      elapsed_ms: modelResult.elapsed_ms,
      usage: { ...modelResult.usage },
      cost: { currency: options.pricing.currency, amount: modelCost },
    },
    "model:balanced",
  );

  if (answer.status === "answered" && answer.citations.length === 0) {
    return failAssertion("CITATION_REQUIRED");
  }

  if (answer.status === "insufficient_context" && answer.citations.length > 0) {
    return failAssertion("CITATION_FORBIDDEN");
  }

  const retrievedDocuments = new Map(
    searchResult.documents.map((document) => [document.id, document] as const),
  );
  if (answer.citations.some((citation) => !citationMatches(citation, retrievedDocuments))) {
    return failAssertion("CITATION_UNKNOWN");
  }

  if (elapsedMs > options.budgets.duration_ms) {
    return failBudget(
      "DURATION_LIMIT_EXCEEDED",
      elapsedMs,
      options.budgets.duration_ms,
      "ms",
    );
  }

  if (modelCost > options.budgets.cost.maximum) {
    return failBudget(
      "COST_LIMIT_EXCEEDED",
      modelCost,
      options.budgets.cost.maximum,
      "USD",
    );
  }

  events.emit("run.succeeded", {
    answer_status: answer.status,
    citation_count: answer.citations.length,
    elapsed_ms: elapsedMs,
    cost: { currency: options.pricing.currency, amount: modelCost },
  });

  return {
    status: "succeeded",
    output: answer,
    events: events.snapshot(),
  };
};

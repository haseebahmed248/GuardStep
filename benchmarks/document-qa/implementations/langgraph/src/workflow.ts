import {
  END,
  START,
  StateGraph,
  StateSchema,
  type ConditionalEdgeRouter,
  type GraphNode,
} from "@langchain/langgraph";
import { z } from "zod/v4";

import { outputSchema, validateOutput } from "./contracts.js";
import { appendEvent } from "./events.js";
import { createModelRequest } from "./prompt.js";
import type {
  Answer,
  Budgets,
  Capability,
  Citation,
  Document,
  FailureCode,
  ModelAdapter,
  PortableEvent,
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

const WorkflowState = new StateSchema({
  runId: z.string(),
  input: z.custom<QuestionInput>(),
  grantedCapabilities: z.custom<ReadonlySet<Capability>>(),
  budgets: z.custom<Budgets>(),
  pricing: z.custom<Pricing>(),
  search: z.custom<SearchAdapter>(),
  model: z.custom<ModelAdapter>(),
  events: z.custom<PortableEvent[]>(),
  elapsedMs: z.number(),
  toolCalls: z.number(),
  modelCalls: z.number(),
  documents: z.custom<Document[]>(),
  output: z.custom<Answer>().nullable(),
  errorCode: z.custom<FailureCode>().nullable(),
  terminal: z.boolean(),
});

type State = typeof WorkflowState.State;
type Update = typeof WorkflowState.Update;

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

const fail = (state: State, errorCode: FailureCode, events = state.events): Update => ({
  errorCode,
  terminal: true,
  events: appendEvent(events, state.runId, "run.failed", { error_code: errorCode }),
});

const failAssertion = (state: State, errorCode: FailureCode, events: PortableEvent[]): Update =>
  fail(
    state,
    errorCode,
    appendEvent(events, state.runId, "assertion.failed", { error_code: errorCode }, "assertion:citations"),
  );

const failBudget = (
  state: State,
  errorCode: "COST_LIMIT_EXCEEDED" | "DURATION_LIMIT_EXCEEDED",
  actual: number,
  maximum: number,
  unit: "USD" | "ms",
  events: PortableEvent[],
): Update =>
  fail(
    state,
    errorCode,
    appendEvent(
      events,
      state.runId,
      "budget.exceeded",
      { error_code: errorCode, actual, maximum, unit },
      errorCode === "COST_LIMIT_EXCEEDED" ? "budget:cost" : "budget:duration",
    ),
  );

const startRun: GraphNode<typeof WorkflowState> = (state) => ({
  events: appendEvent(state.events, state.runId, "run.started", { workflow: "AnswerQuestion" }),
});

const checkCapability: GraphNode<typeof WorkflowState> = (state) => {
  const capability: Capability = "documents.search";
  const granted = state.grantedCapabilities.has(capability);
  const events = appendEvent(
    state.events,
    state.runId,
    "capability.checked",
    { capability, granted },
    "capability:documents.search",
  );

  return granted ? { events } : fail(state, "CAPABILITY_DENIED", events);
};

const searchDocuments: GraphNode<typeof WorkflowState> = async (state) => {
  if (state.toolCalls >= state.budgets.tool_calls) {
    throw new Error("Tool-call budget prevents the benchmark's required search call");
  }

  const toolCalls = state.toolCalls + 1;
  let events = appendEvent(
    state.events,
    state.runId,
    "tool.started",
    { tool: "documents.search", call: toolCalls },
    "tool:documents.search",
  );
  const searchResult = await state.search.search(state.input.question);
  const elapsedMs = state.elapsedMs + searchResult.elapsed_ms;

  if (searchResult.status === "failed") {
    events = appendEvent(
      events,
      state.runId,
      "tool.failed",
      { tool: "documents.search", error_code: searchResult.code, elapsed_ms: searchResult.elapsed_ms },
      "tool:documents.search",
    );
    return { ...fail(state, searchResult.code, events), elapsedMs, toolCalls };
  }

  events = appendEvent(
    events,
    state.runId,
    "tool.succeeded",
    {
      tool: "documents.search",
      document_ids: searchResult.documents.map((document) => document.id),
      elapsed_ms: searchResult.elapsed_ms,
    },
    "tool:documents.search",
  );

  if (elapsedMs > state.budgets.duration_ms) {
    return {
      ...failBudget(
        state,
        "DURATION_LIMIT_EXCEEDED",
        elapsedMs,
        state.budgets.duration_ms,
        "ms",
        events,
      ),
      elapsedMs,
      toolCalls,
      documents: searchResult.documents,
    };
  }

  return { documents: searchResult.documents, elapsedMs, toolCalls, events };
};

const generateAnswer: GraphNode<typeof WorkflowState> = async (state) => {
  if (state.modelCalls >= state.budgets.model_calls) {
    throw new Error("Model-call budget prevents the benchmark's required generation call");
  }

  const modelCalls = state.modelCalls + 1;
  let events = appendEvent(
    state.events,
    state.runId,
    "model.started",
    { profile: "balanced", call: modelCalls },
    "model:balanced",
  );
  const modelResult = await state.model.generate(
    createModelRequest(state.input, state.documents, outputSchema),
  );
  const elapsedMs = state.elapsedMs + modelResult.elapsed_ms;
  const modelCost = calculateCost(modelResult.usage, state.pricing);
  const outputValidation = validateOutput(modelResult.output);

  if (!outputValidation.valid || outputValidation.value === undefined) {
    events = appendEvent(
      events,
      state.runId,
      "model.failed",
      {
        error_code: "MODEL_OUTPUT_INVALID",
        issue_count: outputValidation.errors.length,
        elapsed_ms: modelResult.elapsed_ms,
      },
      "model:balanced",
    );
    return { ...fail(state, "MODEL_OUTPUT_INVALID", events), elapsedMs, modelCalls };
  }

  const answer = outputValidation.value;
  events = appendEvent(
    events,
    state.runId,
    "model.succeeded",
    {
      elapsed_ms: modelResult.elapsed_ms,
      usage: { ...modelResult.usage },
      cost: { currency: state.pricing.currency, amount: modelCost },
    },
    "model:balanced",
  );

  if (answer.status === "answered" && answer.citations.length === 0) {
    return { ...failAssertion(state, "CITATION_REQUIRED", events), elapsedMs, modelCalls };
  }

  if (answer.status === "insufficient_context" && answer.citations.length > 0) {
    return { ...failAssertion(state, "CITATION_FORBIDDEN", events), elapsedMs, modelCalls };
  }

  const retrievedDocuments = new Map(
    state.documents.map((document) => [document.id, document] as const),
  );
  if (answer.citations.some((citation) => !citationMatches(citation, retrievedDocuments))) {
    return { ...failAssertion(state, "CITATION_UNKNOWN", events), elapsedMs, modelCalls };
  }

  if (elapsedMs > state.budgets.duration_ms) {
    return {
      ...failBudget(
        state,
        "DURATION_LIMIT_EXCEEDED",
        elapsedMs,
        state.budgets.duration_ms,
        "ms",
        events,
      ),
      elapsedMs,
      modelCalls,
    };
  }

  if (modelCost > state.budgets.cost.maximum) {
    return {
      ...failBudget(
        state,
        "COST_LIMIT_EXCEEDED",
        modelCost,
        state.budgets.cost.maximum,
        "USD",
        events,
      ),
      elapsedMs,
      modelCalls,
    };
  }

  events = appendEvent(events, state.runId, "run.succeeded", {
    answer_status: answer.status,
    citation_count: answer.citations.length,
    elapsed_ms: elapsedMs,
    cost: { currency: state.pricing.currency, amount: modelCost },
  });

  return { output: answer, terminal: true, events, elapsedMs, modelCalls };
};

const routeAfterCapability: ConditionalEdgeRouter<
  typeof WorkflowState,
  Record<string, unknown>,
  "search_documents"
> = (state) => (state.terminal ? END : "search_documents");

const routeAfterSearch: ConditionalEdgeRouter<
  typeof WorkflowState,
  Record<string, unknown>,
  "generate_answer"
> = (state) => (state.terminal ? END : "generate_answer");

export const documentQaGraph = new StateGraph(WorkflowState)
  .addNode("start_run", startRun)
  .addNode("check_capability", checkCapability)
  .addNode("search_documents", searchDocuments)
  .addNode("generate_answer", generateAnswer)
  .addEdge(START, "start_run")
  .addEdge("start_run", "check_capability")
  .addConditionalEdges("check_capability", routeAfterCapability, ["search_documents", END])
  .addConditionalEdges("search_documents", routeAfterSearch, ["generate_answer", END])
  .addEdge("generate_answer", END)
  .compile();

export const executeDocumentQa = async (
  options: ExecuteDocumentQaOptions,
): Promise<WorkflowRun> => {
  const state = await documentQaGraph.invoke({
    ...options,
    events: [],
    elapsedMs: 0,
    toolCalls: 0,
    modelCalls: 0,
    documents: [],
    output: null,
    errorCode: null,
    terminal: false,
  });

  if (state.errorCode !== null) {
    return { status: "failed", error_code: state.errorCode, events: state.events };
  }
  if (state.output === null) {
    throw new Error("LangGraph completed without an output or failure code");
  }
  return { status: "succeeded", output: state.output, events: state.events };
};

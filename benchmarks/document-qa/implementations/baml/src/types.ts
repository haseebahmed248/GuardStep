import type {
  Answer,
  Citation,
  Document,
} from "../baml_client/types.js";

export type { Answer, Citation, Document };

export type Capability = "documents.search";

export interface QuestionInput {
  question: string;
}

export interface Usage {
  input_tokens: number;
  output_tokens: number;
}

export interface Budgets {
  tool_calls: number;
  model_calls: number;
  duration_ms: number;
  cost: {
    currency: "USD";
    maximum: number;
  };
}

export interface Pricing {
  currency: "USD";
  input_usd_per_million: number;
  output_usd_per_million: number;
  effective_date: string;
  source: string;
}

export type FailureCode =
  | "CAPABILITY_DENIED"
  | "SEARCH_TIMEOUT"
  | "MODEL_OUTPUT_INVALID"
  | "CITATION_REQUIRED"
  | "CITATION_FORBIDDEN"
  | "CITATION_UNKNOWN"
  | "COST_LIMIT_EXCEEDED"
  | "DURATION_LIMIT_EXCEEDED";

export type EventType =
  | "run.started"
  | "capability.checked"
  | "tool.started"
  | "tool.succeeded"
  | "tool.failed"
  | "model.started"
  | "model.succeeded"
  | "model.failed"
  | "assertion.failed"
  | "budget.exceeded"
  | "run.succeeded"
  | "run.failed";

export interface PortableEvent {
  schema_version: 1;
  sequence: number;
  run_id: string;
  type: EventType;
  step_id?: string;
  data: Record<string, unknown>;
}

export interface SearchSuccessFixture {
  behavior: "return";
  document_ids: string[];
  elapsed_ms: number;
}

export interface SearchTimeoutFixture {
  behavior: "timeout";
  elapsed_ms: number;
}

export type SearchFixture = SearchSuccessFixture | SearchTimeoutFixture;

export interface ModelReturnFixture {
  behavior: "return";
  elapsed_ms: number;
  usage: Usage;
  output: unknown;
}

export interface ModelNotReachedFixture {
  behavior: "not_reached";
}

export type ModelFixture = ModelReturnFixture | ModelNotReachedFixture;

export interface ExpectedSuccess {
  status: "succeeded";
  required_events: EventType[];
}

export interface ExpectedFailure {
  status: "failed";
  error_code: FailureCode;
  required_events: EventType[];
}

export type ExpectedResult = ExpectedSuccess | ExpectedFailure;

export interface Scenario {
  id: string;
  input: QuestionInput;
  granted_capabilities: Capability[];
  search: SearchFixture;
  model: ModelFixture;
  expect: ExpectedResult;
}

export interface CorpusFixture {
  schema_version: 1;
  documents: Document[];
}

export interface ScenarioFixture {
  schema_version: 1;
  budgets: Budgets;
  pricing: Pricing;
  scenarios: Scenario[];
}

export interface BamlModelRequest {
  function_name: "AnswerQuestion";
  question: string;
  documents: Document[];
}

export interface SearchSuccess {
  status: "succeeded";
  documents: Document[];
  elapsed_ms: number;
}

export interface SearchFailure {
  status: "failed";
  code: "SEARCH_TIMEOUT";
  elapsed_ms: number;
}

export type SearchResult = SearchSuccess | SearchFailure;

export interface ModelResult {
  output: unknown;
  usage: Usage;
  elapsed_ms: number;
}

export interface SearchAdapter {
  search(question: string): Promise<SearchResult>;
}

export interface ModelAdapter {
  generate(request: BamlModelRequest): Promise<ModelResult>;
}

export interface SuccessfulRun {
  status: "succeeded";
  output: Answer;
  events: PortableEvent[];
}

export interface FailedRun {
  status: "failed";
  error_code: FailureCode;
  events: PortableEvent[];
}

export type WorkflowRun = SuccessfulRun | FailedRun;

import type {
  ModelAdapter,
  PortableEventType,
  Pricing,
  ToolAdapter,
  WorkflowRun,
} from "../runtime/index.js";

export interface GuardTestExpectation {
  readonly status: "succeeded" | "failed";
  readonly errorCode?: string;
  readonly output?: unknown;
  readonly eventTypes: readonly PortableEventType[];
}

export interface GuardTestCase {
  readonly id: string;
  readonly input: unknown;
  readonly grantedCapabilities: readonly string[];
  readonly pricing: Pricing;
  readonly tools: ToolAdapter;
  readonly model: ModelAdapter;
  readonly expect: GuardTestExpectation;
  readonly verify?: (run: WorkflowRun) => readonly string[] | Promise<readonly string[]>;
}

export interface GuardTestSuite {
  readonly schemaVersion: 1;
  readonly workflow: string;
  readonly cases: readonly GuardTestCase[];
}

export interface GuardTestCaseResult {
  readonly id: string;
  readonly passed: boolean;
  readonly failures: readonly string[];
  readonly run: WorkflowRun;
}

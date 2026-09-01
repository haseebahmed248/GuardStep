import type { WorkflowIrV1 } from "../ir/index.js";

export interface TokenUsage {
  readonly input_tokens: number;
  readonly output_tokens: number;
}

export interface Pricing {
  readonly currency: string;
  readonly input_usd_per_million: number;
  readonly output_usd_per_million: number;
  readonly source: string;
  readonly effective_date: string;
}

export interface ToolInvocation {
  readonly runId: string;
  readonly stepId: string;
  readonly tool: string;
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly signal: AbortSignal;
}

export type ToolResult =
  | {
      readonly status: "succeeded";
      readonly value: unknown;
      readonly elapsedMs: number;
      readonly eventData?: Readonly<Record<string, unknown>>;
    }
  | {
      readonly status: "failed";
      readonly kind: "timeout" | "error";
      readonly code?: string;
      readonly elapsedMs: number;
    };

export interface ToolAdapter {
  invoke(request: ToolInvocation): Promise<ToolResult>;
}

export interface ModelInvocation {
  readonly runId: string;
  readonly stepId: string;
  readonly profile: string;
  readonly instructions: string;
  readonly context: Readonly<Record<string, unknown>>;
  readonly outputSchema: Readonly<Record<string, unknown>>;
  readonly signal: AbortSignal;
}

export type ModelResult =
  | {
      readonly status: "succeeded";
      readonly value: unknown;
      readonly usage: TokenUsage;
      readonly elapsedMs: number;
    }
  | {
      readonly status: "failed";
      readonly code: string;
      readonly elapsedMs: number;
    };

export interface ModelAdapter {
  generate(request: ModelInvocation): Promise<ModelResult>;
}

export type PortableEventType =
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
  readonly schema_version: 1;
  readonly sequence: number;
  readonly run_id: string;
  readonly type: PortableEventType;
  readonly step_id?: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface ExecuteOptions {
  readonly ir: WorkflowIrV1;
  readonly workflow: string;
  readonly runId: string;
  readonly input: unknown;
  readonly grantedCapabilities: ReadonlySet<string>;
  readonly pricing: Pricing;
  readonly tools: ToolAdapter;
  readonly model: ModelAdapter;
  readonly clock?: RuntimeClock;
}

export interface RuntimeClock {
  now(): number;
  schedule(delayMs: number, callback: () => void): () => void;
}

export interface WorkflowHost {
  readonly schemaVersion: 1;
  readonly workflow?: string;
  readonly grantedCapabilities: readonly string[];
  readonly pricing: Pricing;
  readonly tools: ToolAdapter;
  readonly model: ModelAdapter;
}

export class RuntimeConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeConfigurationError";
  }
}

export type WorkflowRun =
  | {
      readonly status: "succeeded";
      readonly output: unknown;
      readonly events: readonly PortableEvent[];
    }
  | {
      readonly status: "failed";
      readonly error_code: string;
      readonly events: readonly PortableEvent[];
    };

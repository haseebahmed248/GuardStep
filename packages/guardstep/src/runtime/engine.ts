import type { TypeReference, WorkflowDeclaration } from "../ir/index.js";
import type {
  ExecuteOptions,
  ModelResult,
  Pricing,
  TokenUsage,
  ToolResult,
  WorkflowRun,
} from "./contracts.js";
import { RuntimeConfigurationError } from "./contracts.js";
import { EventRecorder } from "./events.js";
import { ValueSystem } from "./values.js";

export class RuntimeInputError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Workflow input is invalid: ${issues.join("; ")}`);
    this.name = "RuntimeInputError";
  }
}

const calculateCost = (usage: TokenUsage, pricing: Pricing): number =>
  (usage.input_tokens * pricing.input_usd_per_million) / 1_000_000 +
  (usage.output_tokens * pricing.output_usd_per_million) / 1_000_000;

const named = (name: string): TypeReference => ({ kind: "named", name });
const isNonNegativeFinite = (value: number): boolean => Number.isFinite(value) && value >= 0;

const validatePricing = (pricing: Pricing, expectedCurrency: string): void => {
  if (pricing.currency !== expectedCurrency) {
    throw new RuntimeConfigurationError(
      `Pricing currency ${pricing.currency} does not match workflow budget currency ${expectedCurrency}`,
    );
  }
  for (const [name, value] of [
    ["input_usd_per_million", pricing.input_usd_per_million],
    ["output_usd_per_million", pricing.output_usd_per_million],
  ] as const) {
    if (!isNonNegativeFinite(value)) {
      throw new RuntimeConfigurationError(`${name} must be a finite non-negative number`);
    }
  }
  if (pricing.source.trim() === "") {
    throw new RuntimeConfigurationError("Pricing source must not be empty");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(pricing.effective_date)) {
    throw new RuntimeConfigurationError("Pricing effective_date must use YYYY-MM-DD");
  }
};

export const executeWorkflow = async (options: ExecuteOptions): Promise<WorkflowRun> => {
  const workflow = options.ir.workflows.find(({ name }) => name === options.workflow);
  if (workflow === undefined) throw new Error(`Workflow not found: ${options.workflow}`);

  validatePricing(options.pricing, workflow.limits.cost.currency);

  const values = new ValueSystem(options.ir);
  const inputValidation = values.validate(options.input, named(workflow.input.type));
  if (!inputValidation.valid) throw new RuntimeInputError(inputValidation.issues);

  const events = new EventRecorder(options.runId);
  const environment = new Map<string, unknown>([[workflow.input.parameter, options.input]]);
  const capabilityPolicies = new Map(
    workflow.capabilities.map((capability) => [capability.name, capability]),
  );
  let elapsedMs = 0;
  let toolCalls = 0;
  let modelCalls = 0;
  let modelCost = 0;

  const fail = (errorCode: string): WorkflowRun => {
    events.emit("run.failed", { error_code: errorCode });
    return { status: "failed", error_code: errorCode, events: events.snapshot() };
  };

  const failBudget = (
    errorCode: string,
    actual: number,
    maximum: number,
    unit: string,
    kind: "duration" | "cost",
  ): WorkflowRun => {
    events.emit(
      "budget.exceeded",
      { error_code: errorCode, actual, maximum, unit },
      `budget:${kind}`,
    );
    return fail(errorCode);
  };

  const enforceDeferredBudgets = (): WorkflowRun | undefined => {
    if (elapsedMs > workflow.limits.duration.maximum_ms) {
      return failBudget(
        workflow.limits.duration.error,
        elapsedMs,
        workflow.limits.duration.maximum_ms,
        "ms",
        "duration",
      );
    }
    if (modelCost > workflow.limits.cost.maximum) {
      return failBudget(
        workflow.limits.cost.error,
        modelCost,
        workflow.limits.cost.maximum,
        workflow.limits.cost.currency,
        "cost",
      );
    }
    return undefined;
  };

  events.emit("run.started", { workflow: workflow.name });

  for (const step of workflow.steps) {
    if (step.kind === "tool" || step.kind === "model") {
      const budgetFailure = enforceDeferredBudgets();
      if (budgetFailure !== undefined) return budgetFailure;
    }

    if (step.kind === "tool") {
      const capability = capabilityPolicies.get(step.tool);
      if (capability === undefined) throw new Error(`Compiled IR omitted capability for ${step.tool}`);
      const granted = options.grantedCapabilities.has(step.tool);
      events.emit(
        "capability.checked",
        { capability: step.tool, granted },
        `capability:${step.tool}`,
      );
      if (!granted) return fail(capability.denied_error);
      if (toolCalls >= workflow.limits.tool_calls) return fail("TOOL_CALL_LIMIT_EXCEEDED");

      toolCalls += 1;
      events.emit("tool.started", { tool: step.tool, call: toolCalls }, step.step_id);
      const argumentsValue = Object.fromEntries(
        Object.entries(step.arguments).map(([name, expression]) => [
          name,
          values.evaluate(expression, environment),
        ]),
      );
      let result: ToolResult;
      try {
        result = await options.tools.invoke({
          runId: options.runId,
          stepId: step.step_id,
          tool: step.tool,
          arguments: argumentsValue,
        });
      } catch {
        events.emit(
          "tool.failed",
          { tool: step.tool, error_code: step.error_error, elapsed_ms: 0 },
          step.step_id,
        );
        return fail(step.error_error);
      }
      if (!isNonNegativeFinite(result.elapsedMs)) {
        events.emit(
          "tool.failed",
          { tool: step.tool, error_code: step.error_error, elapsed_ms: 0 },
          step.step_id,
        );
        return fail(step.error_error);
      }
      elapsedMs += result.elapsedMs;
      if (result.status === "failed") {
        const errorCode = result.kind === "timeout" ? step.timeout_error : step.error_error;
        events.emit(
          "tool.failed",
          { tool: step.tool, error_code: errorCode, elapsed_ms: result.elapsedMs },
          step.step_id,
        );
        return fail(errorCode);
      }
      const toolDeclaration = options.ir.declarations.tools.find(({ name }) => name === step.tool);
      if (toolDeclaration === undefined) throw new Error(`Compiled IR references unknown tool ${step.tool}`);
      const resultValidation = values.validate(result.value, toolDeclaration.output);
      if (!resultValidation.valid) {
        events.emit(
          "tool.failed",
          {
            tool: step.tool,
            error_code: step.invalid_error,
            issue_count: resultValidation.issues.length,
            elapsed_ms: result.elapsedMs,
          },
          step.step_id,
        );
        return fail(step.invalid_error);
      }
      events.emit(
        "tool.succeeded",
        { ...(result.eventData ?? {}), tool: step.tool, elapsed_ms: result.elapsedMs },
        step.step_id,
      );
      environment.set(step.assign, result.value);
      continue;
    }

    if (step.kind === "model") {
      if (modelCalls >= workflow.limits.model_calls) return fail("MODEL_CALL_LIMIT_EXCEEDED");
      modelCalls += 1;
      events.emit("model.started", { profile: step.profile, call: modelCalls }, step.step_id);
      const context = Object.fromEntries(
        Object.entries(step.context).map(([name, expression]) => [
          name,
          values.evaluate(expression, environment),
        ]),
      );
      let result: ModelResult;
      try {
        result = await options.model.generate({
          runId: options.runId,
          stepId: step.step_id,
          profile: step.profile,
          instructions: step.instructions,
          context,
          outputSchema: values.schema(named(step.output_type)),
        });
      } catch {
        events.emit(
          "model.failed",
          { error_code: step.error_error, elapsed_ms: 0 },
          step.step_id,
        );
        return fail(step.error_error);
      }
      if (
        !isNonNegativeFinite(result.elapsedMs) ||
        (result.status === "succeeded" && (
          !isNonNegativeFinite(result.usage.input_tokens) ||
          !isNonNegativeFinite(result.usage.output_tokens)
        ))
      ) {
        events.emit(
          "model.failed",
          { error_code: step.error_error, elapsed_ms: 0 },
          step.step_id,
        );
        return fail(step.error_error);
      }
      elapsedMs += result.elapsedMs;
      if (result.status === "failed") {
        events.emit(
          "model.failed",
          { error_code: step.error_error, elapsed_ms: result.elapsedMs },
          step.step_id,
        );
        return fail(step.error_error);
      }
      const outputValidation = values.validate(result.value, named(step.output_type));
      if (!outputValidation.valid) {
        events.emit(
          "model.failed",
          {
            error_code: step.invalid_error,
            issue_count: outputValidation.issues.length,
            elapsed_ms: result.elapsedMs,
          },
          step.step_id,
        );
        return fail(step.invalid_error);
      }
      modelCost += calculateCost(result.usage, options.pricing);
      events.emit(
        "model.succeeded",
        {
          elapsed_ms: result.elapsedMs,
          usage: { ...result.usage },
          cost: { currency: options.pricing.currency, amount: modelCost },
        },
        step.step_id,
      );
      environment.set(step.assign, result.value);
      continue;
    }

    if (step.kind === "assertion") {
      const passed = values.requireBoolean(values.evaluate(step.condition, environment));
      if (!passed) {
        events.emit("assertion.failed", { error_code: step.error }, step.step_id);
        return fail(step.error);
      }
      continue;
    }

    const budgetFailure = enforceDeferredBudgets();
    if (budgetFailure !== undefined) return budgetFailure;
    const output = values.evaluate(step.value, environment);
    const outputValidation = values.validate(output, named(workflow.output));
    if (!outputValidation.valid) throw new Error(`Compiler allowed invalid return: ${outputValidation.issues.join("; ")}`);
    events.emit("run.succeeded", {
      elapsed_ms: elapsedMs,
      cost: { currency: options.pricing.currency, amount: modelCost },
    });
    return { status: "succeeded", output, events: events.snapshot() };
  }

  throw new Error(`Compiled workflow ${workflow.name} ended without return`);
};

export const assertWorkflowExists = (
  workflow: WorkflowDeclaration | undefined,
): asserts workflow is WorkflowDeclaration => {
  if (workflow === undefined) throw new Error("Workflow does not exist");
};

import type { WorkflowIr, WorkflowStep } from "./types.js";

interface Calls {
  readonly tool: number;
  readonly model: number;
}

interface FlowSummary {
  readonly maximum: Calls;
  readonly continuing: Calls | undefined;
}

const zero = (): Calls => ({ tool: 0, model: 0 });
const add = (a: Calls, b: Calls): Calls => ({ tool: a.tool + b.tool, model: a.model + b.model });
const max = (a: Calls, b: Calls): Calls => ({ tool: Math.max(a.tool, b.tool), model: Math.max(a.model, b.model) });

/** Conservative per-resource path bounds, without enumerating combinations of arms. */
export const summarizeFlow = (steps: readonly WorkflowStep[]): FlowSummary => {
  let maximum = zero();
  let continuing: Calls | undefined = zero();
  for (const step of steps) {
    if (continuing === undefined) break;
    if (step.kind === "branch") {
      const yes = summarizeFlow(step.then);
      const no = summarizeFlow(step.else);
      maximum = max(maximum, add(continuing, max(yes.maximum, no.maximum)));
      const armContinuation = yes.continuing === undefined ? no.continuing
        : no.continuing === undefined ? yes.continuing : max(yes.continuing, no.continuing);
      continuing = armContinuation === undefined ? undefined : add(continuing, armContinuation);
    } else if (step.kind === "return" || step.kind === "fail") {
      maximum = max(maximum, continuing);
      continuing = undefined;
    } else {
      continuing = add(continuing, { tool: Number(step.kind === "tool"), model: Number(step.kind === "model") });
      maximum = max(maximum, continuing);
    }
  }
  return { maximum, continuing };
};

/** Version/node compatibility guard, not a validator for untrusted arbitrary JSON. */
export const assertSupportedIr = (ir: WorkflowIr): void => {
  if (ir.schema_version !== 1 && ir.schema_version !== 2) {
    throw new Error("Unsupported workflow IR version; expected 1 or 2");
  }
  const pending: WorkflowStep[] = ir.workflows.flatMap((workflow) => [...workflow.steps]);
  while (pending.length > 0) {
    const step = pending.pop()!;
    switch (step.kind) {
      case "branch":
        if (ir.schema_version !== 2) throw new Error("Branch steps require workflow IR version 2");
        pending.push(...step.then, ...step.else);
        break;
      case "fail":
        if (ir.schema_version !== 2) throw new Error("Fail steps require workflow IR version 2");
        break;
      case "tool": case "model": case "assertion": case "return": break;
      default: throw new Error("Unsupported workflow IR step");
    }
  }
};

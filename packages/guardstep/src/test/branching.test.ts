import assert from "node:assert/strict";
import test from "node:test";
import { compileSource, GuardStepDiagnosticError } from "../compiler/index.js";
import { generateTypeScript } from "../codegen/index.js";
import type { WorkflowIr, WorkflowIrV2, WorkflowStep } from "../ir/index.js";
import { summarizeFlow } from "../ir/control-flow.js";
import { executeWorkflow } from "../runtime/index.js";
import type { ExecuteOptions, RuntimeClock } from "../runtime/index.js";
import { invokeBeforeDeadline } from "../runtime/deadline.js";

const source = (body: string, tools = 2, models = 2): string => `
enum Failure { DENIED TIMEOUT ERROR INVALID DURATION COST STOP }
record Input { text: String }
record Other { text: String }
tool echo(text: String) -> Input
tool other(text: String) -> Other
workflow Decide(input: Input) -> Input fails Failure {
  capabilities { echo else DENIED other else DENIED }
  limits {
    tool_calls <= ${tools}
    model_calls <= ${models}
    duration <= 100ms else DURATION
    cost <= 1 USD else COST
  }
  ${body}
}`;

const call = (name: string, tool = "echo"): string =>
  `${name} = call ${tool}(text: input.text) on timeout => fail TIMEOUT on error => fail ERROR on invalid => fail INVALID`;
const model = (name: string, context = "input.text"): string =>
  `${name} = generate Input using model("local") { instructions: "Echo" context: { text: ${context} } } on error => fail ERROR on invalid => fail INVALID`;
const compile = (body: string, tools = 2, models = 2): WorkflowIr =>
  compileSource({ source: source(body, tools, models), sourcePath: "branch.guard" });
const invalid = (body: string, code: string): void => {
  assert.throws(() => compile(body), (error: unknown) => {
    assert.ok(error instanceof GuardStepDiagnosticError);
    const diagnostic = error.diagnostics.find((entry) => entry.code === code);
    assert.ok(diagnostic, JSON.stringify(error.diagnostics));
    assert.equal(diagnostic.sourcePath, "branch.guard");
    assert.ok(diagnostic.range.start.line > 0);
    assert.ok(diagnostic.range.end.offset >= diagnostic.range.start.offset);
    if (diagnostic.range.end.offset === diagnostic.range.start.offset) {
      assert.equal(diagnostic.range.start.offset, source(body).length, "Only EOF should have an empty range");
    }
    return true;
  });
};

const options = (ir: WorkflowIr, text = "yes"): ExecuteOptions => ({
  ir, workflow: "Decide", runId: "branch-test", input: { text },
  grantedCapabilities: new Set(["echo", "other"]),
  pricing: { currency: "USD", input_usd_per_million: 1_000_000, output_usd_per_million: 0, source: "test", effective_date: "2026-09-07" },
  tools: { invoke: async ({ arguments: args }) => ({ status: "succeeded", value: { text: args.text }, elapsedMs: 0 }) },
  model: { generate: async ({ context }) => ({ status: "succeeded", value: { text: context.text }, usage: { input_tokens: 0, output_tokens: 0 }, elapsedMs: 0 }) },
});
const failure = async (opts: ExecuteOptions, code: string): Promise<void> => {
  const run = await executeWorkflow(opts);
  assert.equal(run.status, "failed");
  if (run.status !== "failed") assert.fail("Expected failure");
  assert.equal(run.error_code, code);
  assert.equal(run.events.filter((event) => event.type === "run.failed").length, 1);
  assert.equal(run.events.at(-1)?.type, "run.failed");
};

for (const [body, code] of [
  ['if input.text { return input } else { fail STOP }', "GS2201"],
  ['if input.text == "yes" { return input }', "GS2202"],
  ['if true { return input }', "GS2202"],
  ['if true { return input } else { if false { fail STOP } }', "GS2202"],
  ['if true { return input } else { fail STOP } return input', "GS2203"],
  ['if true { fail STOP return input } else { return input }', "GS2203"],
  ['fail STOP return input', "GS2203"],
  ['if false { fail MISSING } else { return input }', "GS2003"],
  [`if true { ${call("result", "other")} return result } else { return input }`, "GS2202"],
  [`if true { ${call("result")} } return result`, "GS2101"],
  [`if true { ${call("result")} return result } else { return result }`, "GS2101"],
  [`if true { ${call("input")} return input } else { return input }`, "GS2103"],
  ['if call echo(text: input.text) { return input } else { return input }', "GS2004"],
  ['if true { capabilities {} return input } else { return input }', "GS1004"],
  ['if true { limits {} return input } else { return input }', "GS1004"],
  ['if true { return input', "GS1004"],
] as const) {
  test(`branch diagnostics ${code}: ${body}`, () => invalid(body, code));
}

test("branches preserve declared capability checking even in the unselected arm", () => {
  const program = source(`if false { ${call("result")} return result } else { return input }`)
    .replace("echo else DENIED", "");
  assert.throws(() => compileSource({ source: program, sourcePath: "branch.guard" }),
    (error: unknown) => error instanceof GuardStepDiagnosticError && error.diagnostics.some((d) => d.code === "GS2002"));
});

test("v2 lowering is deterministic, serializable, and uses distinct arm paths", async () => {
  const body = `if input.text == "yes" { ${call("result")} return result } else { ${call("result")} return result }`;
  const ir = compile(body, 1);
  assert.equal(ir.schema_version, 2);
  assert.deepEqual(ir, compile(body, 1));
  const roundtrip: WorkflowIr = JSON.parse(JSON.stringify(ir));
  assert.deepEqual(roundtrip, ir);
  const branch = ir.workflows[0]!.steps[0]!;
  assert.equal(branch.kind, "branch");
  if (branch.kind !== "branch") assert.fail("Expected branch");
  assert.equal(branch.step_id, "Decide/branch:0");
  assert.equal(branch.then[0]!.step_id, "Decide/branch:0/then/tool:result");
  assert.equal(branch.else[0]!.step_id, "Decide/branch:0/else/tool:result");
  for (const text of ["yes", "no"]) {
    let calls = 0;
    const opts = options(roundtrip, text);
    const run = await executeWorkflow({ ...opts, tools: { invoke: async (request) => {
      calls++;
      assert.match(request.stepId, text === "yes" ? /\/then\// : /\/else\//);
      return opts.tools.invoke(request);
    } } });
    assert.equal(calls, 1);
    assert.equal(run.status, "succeeded");
    if (run.status === "succeeded") assert.deepEqual(run.output, { text });
  }
});

test("nested else-if and explicit failure terminate the whole workflow", async () => {
  const ir = compile('if input.text == "yes" { if true { return input } else { fail ERROR } } else if input.text == "no" { fail STOP } else { return input }');
  for (const text of ["yes", "other"]) assert.equal((await executeWorkflow(options(ir, text))).status, "succeeded");
  await failure(options(ir, "no"), "STOP");
  await failure(options(compile("fail STOP")), "STOP");
});

test("an early return skips continuation effects", async () => {
  const ir = compile(`if input.text == "yes" { return input } ${call("result")} return result`, 1);
  await executeWorkflow({ ...options(ir), tools: { invoke: async () => assert.fail("must not dispatch") } });
  assert.equal((await executeWorkflow(options(ir, "no"))).status, "succeeded");
});

test("arm-local bindings can be reused after the branch without escaping", async () => {
  const ir = compile(`if true { ${call("result", "other")} } ${call("result")} return result`);
  assert.equal((await executeWorkflow(options(ir))).status, "succeeded");
});

test("path bounds count mutually exclusive arms and exclude terminal continuations", () => {
  const body = `if input.text == "yes" { ${call("a")} ${call("b")} return b } ${call("c")} ${call("d")} return d`;
  assert.deepEqual(summarizeFlow(compile(body, 2).workflows[0]!.steps).maximum, { tool: 2, model: 0 });
  const accumulated = `if true { ${call("a")} } if false { ${call("b")} } return input`;
  assert.throws(() => compile(accumulated, 1), GuardStepDiagnosticError);
  const models = `if true { ${model("a")} return a } else { ${model("b")} return b }`;
  assert.deepEqual(summarizeFlow(compile(models, 0, 1).workflows[0]!.steps).maximum, { tool: 0, model: 1 });
  assert.throws(() => compile(`if true { ${model("a")} } ${model("b")} return b`, 0, 1), GuardStepDiagnosticError);
});

test("many sequential branches are summarized without enumerating paths", () => {
  const body = Array.from({ length: 100 }, () => "if true {} else {}").join("\n") + "\nreturn input";
  assert.deepEqual(summarizeFlow(compile(body, 0, 0).workflows[0]!.steps).maximum, { tool: 0, model: 0 });
});

test("runtime grants apply only to selected effects", async () => {
  const ir = compile(`if input.text == "yes" { ${call("result")} return result } else { return input }`);
  const denied = { ...options(ir), grantedCapabilities: new Set<string>(), tools: { invoke: async () => assert.fail("denied tool ran") } };
  await failure(denied, "DENIED");
  assert.equal((await executeWorkflow({ ...denied, input: { text: "no" } })).status, "succeeded");
});

test("selected branch failures retain tool, model, assertion and validation mappings", async () => {
  const toolIr = compile(`if true { ${call("a")} return a } else { return input }`);
  for (const kind of ["timeout", "error"] as const) {
    await failure({ ...options(toolIr), tools: { invoke: async () => ({ status: "failed", kind, elapsedMs: 0 }) } }, kind === "timeout" ? "TIMEOUT" : "ERROR");
  }
  await failure({ ...options(toolIr), tools: { invoke: async () => ({ status: "succeeded", value: {}, elapsedMs: 0 }) } }, "INVALID");
  const modelIr = compile(`if true { ${model("a")} return a } else { return input }`);
  await failure({ ...options(modelIr), model: { generate: async () => ({ status: "failed", code: "private", elapsedMs: 0 }) } }, "ERROR");
  await failure({ ...options(modelIr), model: { generate: async () => ({ status: "succeeded", value: {}, usage: { input_tokens: 0, output_tokens: 0 }, elapsedMs: 0 }) } }, "INVALID");
  await failure(options(compile("if true { require false else STOP return input } else { return input }")), "STOP");
});

const withCallLimit = (ir: WorkflowIr, field: "tool_calls" | "model_calls"): WorkflowIrV2 => ({
  ...ir, schema_version: 2,
  workflows: ir.workflows.map((workflow) => ({ ...workflow, limits: { ...workflow.limits, [field]: 1 } })),
});

test("runtime counters are shared across branch entry and exit", async () => {
  let tools = 0;
  const toolIr = withCallLimit(compile(`${call("a")} if true { ${call("b")} return b } else { return a }`), "tool_calls");
  const toolOptions = options(toolIr);
  await failure({ ...toolOptions, tools: { invoke: async (request) => { tools++; return toolOptions.tools.invoke(request); } } }, "TOOL_CALL_LIMIT_EXCEEDED");
  assert.equal(tools, 1);
  let models = 0;
  const modelIr = withCallLimit(compile(`if true { ${model("a")} } ${model("b")} return b`), "model_calls");
  const modelOptions = options(modelIr);
  await failure({ ...modelOptions, model: { generate: async (request) => { models++; return modelOptions.model.generate(request); } } }, "MODEL_CALL_LIMIT_EXCEEDED");
  assert.equal(models, 1);
});

test("cost and accounted time do not reset in branches or before explicit failure", async () => {
  const ir = compile(`if true { ${model("a")} } if true { ${call("b")} return b } else { fail STOP }`);
  for (const [elapsedMs, inputTokens, code] of [[101, 0, "DURATION"], [0, 2, "COST"]] as const) {
    const opts = { ...options(ir),
      tools: { invoke: async () => assert.fail("over-budget effect ran") },
      model: { generate: async () => ({ status: "succeeded" as const, value: { text: "yes" }, usage: { input_tokens: inputTokens, output_tokens: 0 }, elapsedMs }) },
    };
    await failure(opts, code);
    await failure({ ...opts, ir: compile(`if true { ${model("a")} fail STOP } else { return input }`) }, code);
  }
});

test("two selected arms accumulate model charges", async () => {
  let calls = 0;
  const ir = compile(`if true { ${model("a")} } if true { ${model("b")} } return input`);
  await failure({ ...options(ir), model: { generate: async () => {
    calls++;
    return { status: "succeeded", value: { text: "yes" }, usage: { input_tokens: 1, output_tokens: 0 }, elapsedMs: 0 };
  } } }, "COST");
  assert.equal(calls, 2);
});

test("a selected hanging model is aborted by the shared workflow deadline", async () => {
  let aborted = false;
  const ir = compile(`if true { ${model("a")} return a } else { return input }`);
  await failure({ ...options(ir), model: { generate: async ({ signal }) => {
    signal.addEventListener("abort", () => { aborted = true; }, { once: true });
    return new Promise(() => {});
  } } }, "DURATION");
  assert.equal(aborted, true);
});

test("deadline equality after a branch effect cannot dispatch the next adapter", async () => {
  let now = 0;
  let calls = 0;
  const clock: RuntimeClock = { now: () => now, schedule: () => () => {} };
  const ir = compile(`if true { ${call("a")} } if true { ${call("b")} return b } else { return input }`);
  await failure({ ...options(ir), clock, tools: { invoke: async () => {
    calls++;
    now = 100;
    return { status: "succeeded", value: { text: "yes" }, elapsedMs: 100 };
  } } }, "DURATION");
  assert.equal(calls, 1);
});

test("deadline helper checks expiry both before scheduling and at microtask dispatch", async () => {
  let now = 10;
  const clock: RuntimeClock = { now: () => now, schedule: () => () => {} };
  assert.equal((await invokeBeforeDeadline(clock, 10, async () => assert.fail("expired adapter ran"))).status, "deadline_exceeded");
  now = 0;
  const pending = invokeBeforeDeadline(clock, 10, async () => assert.fail("late adapter ran"));
  now = 10;
  assert.equal((await pending).status, "deadline_exceeded");
});

test("runtime rejects unsupported IR versions and v1 control flow before effects", async () => {
  const ir = compile("if true { return input } else { fail STOP }");
  for (const schema_version of [1, 99]) {
    const invalidIr = { ...ir, schema_version } as unknown as WorkflowIr;
    await assert.rejects(executeWorkflow(options(invalidIr)), /IR version|version 2/);
    assert.throws(() => generateTypeScript(invalidIr), /IR version|version 2/);
  }
});

test("generated model contracts follow lexical environments in sibling and nested arms", () => {
  const ir = compile(`if true { ${call("local")} if true { ${model("answer", "local.text")} return answer } else { return input } } else { ${model("answer")} return answer }`);
  const generated = generateTypeScript(ir);
  assert.equal(generated, generateTypeScript(ir));
  assert.match(generated, /DecideBranch0ThenBranch1ThenAnswerModelInvocation/);
  assert.match(generated, /DecideBranch0ElseAnswerModelInvocation/);
  assert.match(generated, /readonly "text": string;/);
  assert.match(generated, /Decide\/branch:0\/then\/branch:1\/then\/model:answer/);
});

test("all nested step IDs are unique when siblings reuse assignment names", () => {
  const ir = compile(`if true { ${model("answer")} return answer } else { ${model("answer")} return answer }`);
  const ids: string[] = [];
  const walk = (steps: readonly WorkflowStep[]): void => {
    for (const step of steps) { ids.push(step.step_id); if (step.kind === "branch") { walk(step.then); walk(step.else); } }
  };
  walk(ir.workflows[0]!.steps);
  assert.equal(new Set(ids).size, ids.length);
});

test("new control-flow keywords do not break legacy assignment identifiers", async () => {
  for (const name of ["if", "fail"]) {
    const ir = compile(`${call(name)} return ${name}`, 1, 0);
    assert.equal(ir.schema_version, 1);
    assert.equal((await executeWorkflow(options(ir))).status, "succeeded");
  }
});

test("a final return at the exact accounting boundary remains allowed", async () => {
  let now = 0;
  const ir = compile(`if true { ${call("a")} return a } else { return input }`);
  const run = await executeWorkflow({
    ...options(ir), clock: { now: () => now, schedule: () => () => {} },
    tools: { invoke: async () => {
      now = 100;
      return { status: "succeeded", value: { text: "yes" }, elapsedMs: 100 };
    } },
  });
  assert.equal(run.status, "succeeded");
});

test("time and cost are rechecked when returning from nested branches", async () => {
  const ir = compile(`if true { if true { ${model("a")} return a } else { fail STOP } } else { return input }`);
  await failure({ ...options(ir), model: { generate: async () => ({
    status: "succeeded", value: { text: "yes" }, usage: { input_tokens: 2, output_tokens: 0 }, elapsedMs: 0,
  }) } }, "COST");
  await failure({ ...options(ir), model: { generate: async () => ({
    status: "succeeded", value: { text: "yes" }, usage: { input_tokens: 0, output_tokens: 0 }, elapsedMs: 101,
  }) } }, "DURATION");
});

test("v2 assertions on the same source line have distinct IDs", () => {
  const ir = compile("require true else STOP require true else STOP if true { require true else STOP require true else STOP return input } else { fail STOP }");
  const steps = ir.workflows[0]!.steps;
  assert.notEqual(steps[0]!.step_id, steps[1]!.step_id);
  const branch = steps[2]!;
  if (branch.kind !== "branch") assert.fail("Expected branch");
  assert.notEqual(branch.then[0]!.step_id, branch.then[1]!.step_id);
});

test("adapter-reported duration accumulates across sibling branches", async () => {
  const ir = compile(`if true { ${model("a")} } if true { ${model("b")} } ${call("c")} return c`);
  let models = 0;
  await failure({ ...options(ir),
    tools: { invoke: async () => assert.fail("effect ran after accumulated duration was exhausted") },
    model: { generate: async () => {
      models++;
      return { status: "succeeded", value: { text: "yes" }, usage: { input_tokens: 0, output_tokens: 0 }, elapsedMs: 60 };
    } },
  }, "DURATION");
  assert.equal(models, 2);
});

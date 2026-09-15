import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { compileSource, GuardStepDiagnosticError } from "../compiler/index.js";
import { generateTypeScript } from "../codegen/index.js";
import { executeWorkflow } from "../runtime/index.js";

const source = readFileSync(new URL("../../../../fixtures/diagnostics/null-tool-argument.guard", import.meta.url), "utf8");
const compile = (text: string) => compileSource({ source: text, sourcePath: "null-arguments.guard" });
const pricing = {
  currency: "USD", input_usd_per_million: 0, output_usd_per_million: 0,
  source: "test", effective_date: "2026-09-15",
};

for (const type of ["String", "Url", "Input", "List<String>", "null"]) {
  test(`rejects null for a non-nullable ${type} tool argument`, () => {
    const text = `record null { text: String }\n${source.replace("tool echo(text: String)", `tool echo(text: ${type})`)}`;
    assert.throws(() => compile(text), (error) => {
      assert.ok(error instanceof GuardStepDiagnosticError);
      assert.equal(error.diagnostics.length, 1);
      assert.equal(error.diagnostics[0]?.code, "GS2105");
      assert.equal(error.diagnostics[0]?.message, `Argument 'text' expects ${type}, received null`);
      return true;
    });
  });
}

for (const argument of ['"hello"', '"null"', "input.text"]) {
  test(`preserves String tool argument ${argument}`, async () => {
    const ir = compile(source.replace("text: null", `text: ${argument}`));
    let calls = 0;
    let received: unknown;
    const run = await executeWorkflow({
      ir, workflow: "Example", runId: "string-argument", input: { text: "input value" },
      grantedCapabilities: new Set(["echo"]), pricing,
      tools: { invoke: async (request) => {
        calls += 1;
        received = request.arguments.text;
        return { status: "succeeded", value: { text: "ok" }, elapsedMs: 0 };
      } },
      model: { generate: async () => assert.fail("Model must not run") },
    });
    assert.equal(calls, 1);
    assert.equal(received, argument === "input.text" ? "input value" : JSON.parse(argument));
    assert.equal(run.status, "succeeded");
  });
}

test("preserves null model context through IR, code generation and runtime", async () => {
  const ir = compile(`enum Failure { ERROR INVALID DURATION COST }
record Input { text: String }
workflow Example(input: Input) -> Input fails Failure {
  capabilities {}
  limits {
    tool_calls <= 0
    model_calls <= 1
    duration <= 1s else DURATION
    cost <= 0 USD else COST
  }
  answer = generate Input using model("test") {
    instructions: "Return a valid result."
    context: { missing: null literal: "null" text: input.text }
  } on error => fail ERROR on invalid => fail INVALID
  return answer
}`);
  assert.equal(ir.schema_version, 1);
  assert.match(generateTypeScript(ir), /readonly "missing": null;/);
  assert.match(generateTypeScript(ir), /readonly "literal": string;/);
  let received: unknown;
  const run = await executeWorkflow({
    ir: JSON.parse(JSON.stringify(ir)), workflow: "Example", runId: "null-context",
    input: { text: "hello" }, grantedCapabilities: new Set(), pricing,
    tools: { invoke: async () => assert.fail("Tool must not run") },
    model: { generate: async (request) => {
      received = request.context;
      return { status: "succeeded", value: { text: "ok" }, elapsedMs: 0,
        usage: { input_tokens: 0, output_tokens: 0 } };
    } },
  });
  assert.equal(run.status, "succeeded");
  assert.deepEqual(received, { missing: null, literal: "null", text: "hello" });
});

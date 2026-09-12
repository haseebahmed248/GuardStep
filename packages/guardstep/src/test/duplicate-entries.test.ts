import assert from "node:assert/strict";
import test from "node:test";

import { compileSource } from "../compiler/index.js";

const source = `enum Failure { DENIED TIMEOUT ERROR INVALID DURATION COST }
record Input { text: String }
tool echo(first: String, second: String) -> Input
workflow Example(input: Input) -> Input fails Failure {
  capabilities { echo else DENIED }
  limits {
    cost <= 0 USD else COST
    duration <= 1s else DURATION
    model_calls <= 2
    tool_calls <= 2
  }
  first = call echo(second: "suffix", first: input.text)
    on timeout => fail TIMEOUT
    on error => fail ERROR
    on invalid => fail INVALID
  second = call echo(first: first.text, second: "another")
    on timeout => fail TIMEOUT
    on error => fail ERROR
    on invalid => fail INVALID
  generated = generate Input using model("test") {
    instructions: "Return the input."
    context: { second: second.text, first: first.text }
  }
    on error => fail ERROR
    on invalid => fail INVALID
  result = generate Input using model("test") {
    instructions: "Return the input."
    context: { first: generated.text second: second.text }
  }
    on error => fail ERROR
    on invalid => fail INVALID
  return result
}
`;

test("unique limits may be reordered and repeated in another workflow", () => {
  const ir = compileSource({
    source: source + source.slice(source.indexOf("workflow")).replace("workflow Example", "workflow Another"),
    sourcePath: "unique.guard",
  });
  assert.equal(ir.workflows.length, 2);
  for (const workflow of ir.workflows) {
    assert.deepEqual(workflow.limits, {
      tool_calls: 2,
      model_calls: 2,
      duration: { maximum_ms: 1000, error: "DURATION" },
      cost: { maximum: 0, currency: "USD", error: "COST" },
    });
  }
});

test("unique argument and context keys retain source order and may recur in other steps", () => {
  const ir = compileSource({ source, sourcePath: "unique.guard" });
  const [first, second, generated, result] = ir.workflows[0]!.steps;
  assert.ok(first?.kind === "tool" && second?.kind === "tool");
  assert.deepEqual(Object.keys(first.arguments), ["second", "first"]);
  assert.deepEqual(Object.keys(second.arguments), ["first", "second"]);
  assert.deepEqual(first.arguments.second, { kind: "literal", value: "suffix" });
  assert.deepEqual(second.arguments.second, { kind: "literal", value: "another" });
  assert.ok(generated?.kind === "model" && result?.kind === "model");
  assert.deepEqual(Object.keys(generated.context), ["second", "first"]);
  assert.deepEqual(Object.keys(result.context), ["first", "second"]);
  assert.deepEqual(result.context.first, {
    kind: "member", target: { kind: "identifier", name: "generated" }, property: "text",
  });
});

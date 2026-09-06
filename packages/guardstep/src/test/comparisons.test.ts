import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { compileSource, GuardStepDiagnosticError } from "../compiler/index.js";
import { ValueSystem } from "../runtime/index.js";

const sourceFor = (expression: string): string => `enum Failure { ASSERT DURATION COST }
enum Choice { alpha beta }
record Input { text: String url: Url choices: List<String> choice: Choice }
workflow Example(input: Input) -> Input fails Failure {
  capabilities {}
  limits {
    tool_calls <= 0
    model_calls <= 0
    duration <= 1s else DURATION
    cost <= 0 USD else COST
  }
  require ${expression} else ASSERT
  return input
}
`;

for (const operator of ["<", "<=", ">", ">="]) {
  for (const [name, left, right] of [
    ["booleans", "true", "false"],
    ["records", "input", "input"],
    ["lists", "input.choices", "input.choices"],
  ]) {
    test(`rejects ${operator} ordering of ${name} during compilation`, () => {
      assert.throws(
        () => compileSource({ source: sourceFor(`${left} ${operator} ${right}`), sourcePath: "ordering.guard" }),
        (error) => {
          assert.ok(error instanceof GuardStepDiagnosticError);
          assert.equal(error.diagnostics.length, 1);
          const diagnostic = error.diagnostics[0]!;
          assert.equal(diagnostic.code, "GS2105");
          assert.equal(diagnostic.sourcePath, "ordering.guard");
          assert.equal(diagnostic.range.start.line, 12);
          assert.equal(diagnostic.range.start.column, 3);
          assert.match(diagnostic.message, /ordering|order|numbers or strings/i);
          return true;
        },
      );
    });
  }

  for (const [name, left, right] of [
    ["numbers", "1", "2"],
    ["strings", '"a"', '"b"'],
    ["URLs", "input.url", "input.url"],
    ["enum values", "alpha", "beta"],
    ["enum fields", "input.choice", "beta"],
  ]) {
    test(`preserves ${operator} ordering of ${name} at compile time and runtime`, () => {
      const ir = compileSource({ source: sourceFor(`${left} ${operator} ${right}`), sourcePath: "ordering.guard" });
      const step = ir.workflows[0]!.steps[0]!;
      assert.equal(step.kind, "assertion");
      if (step.kind !== "assertion") assert.fail("Expected assertion");
      const result = new ValueSystem(ir).evaluate(step.condition, new Map([
        ["input", { text: "a", url: "https://example.com", choices: [], choice: "alpha" }],
      ]));
      const expected = name === "URLs" ? operator === "<=" || operator === ">=" : operator === "<" || operator === "<=";
      assert.equal(result, expected);
    });
  }
}

for (const expression of ["true == true", "true != false", "alpha == alpha", "alpha != beta"]) {
  test(`preserves equality: ${expression}`, () => {
    const ir = compileSource({ source: sourceFor(expression), sourcePath: "equality.guard" });
    const step = ir.workflows[0]!.steps[0]!;
    if (step.kind !== "assertion") assert.fail("Expected assertion");
    assert.equal(new ValueSystem(ir).evaluate(step.condition, new Map()), true);
  });
}

test("CLI check rejects unsupported ordering with a source-located diagnostic", () => {
  const directory = mkdtempSync(join(tmpdir(), "guardstep-ordering-"));
  try {
    writeFileSync(join(directory, "ordering.guard"), sourceFor("true > false"));
    const cli = fileURLToPath(new URL("../cli/main.js", import.meta.url));
    const result = spawnSync(process.execPath, [cli, "check", "ordering.guard"], {
      cwd: directory,
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
    });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /ordering\.guard:12:3 GS2105/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

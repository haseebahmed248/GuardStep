import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";

import { compileSource, GuardStepDiagnosticError } from "../compiler/index.js";

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const sourcePath = `${repositoryRoot}examples/document-qa/answer.guard`;
const validSource = readFileSync(sourcePath, "utf8");

const diagnosticCodes = (source: string): readonly string[] => {
  try {
    compileSource({ source, sourcePath: "fixture.guard" });
    assert.fail("Expected compilation to fail");
  } catch (error) {
    assert.ok(error instanceof GuardStepDiagnosticError);
    for (const diagnostic of error.diagnostics) {
      assert.equal(diagnostic.sourcePath, "fixture.guard");
      assert.ok(diagnostic.range.start.line >= 1);
      assert.ok(diagnostic.range.start.column >= 1);
    }
    return error.diagnostics.map(({ code }) => code);
  }
};

test("compiles the executable document Q&A source into deterministic IR", () => {
  const first = compileSource({ source: validSource, sourcePath });
  const second = compileSource({ source: validSource, sourcePath });

  assert.deepEqual(first, second);
  assert.equal(first.schema_version, 1);
  assert.match(first.source.sha256, /^sha256:[0-9a-f]{64}$/);
  assert.equal(first.workflows[0]?.name, "AnswerQuestion");
  assert.deepEqual(
    first.workflows[0]?.steps.map(({ kind }) => kind),
    ["tool", "model", "assertion", "assertion", "assertion", "return"],
  );
});

test("rejects a tool call without a capability", () => {
  const source = validSource.replace("    documents.search else CAPABILITY_DENIED\n", "");
  assert.ok(diagnosticCodes(source).includes("GS2002"));
});

test("rejects an invalid record field", () => {
  const source = validSource.replace("question: input.question", "question: input.missing");
  assert.ok(diagnosticCodes(source).includes("GS2102"));
});

test("rejects an undeclared failure code", () => {
  const source = validSource.replace("else CITATION_REQUIRED", "else NOT_DECLARED");
  assert.ok(diagnosticCodes(source).includes("GS2003"));
});

test("rejects an undeclared invalid tool-output failure", () => {
  const source = validSource.replace(
    "on invalid => fail TOOL_OUTPUT_INVALID",
    "on invalid => fail NOT_DECLARED",
  );
  assert.ok(diagnosticCodes(source).includes("GS2003"));
});

test("rejects a workflow without a return", () => {
  const source = validSource.replace("\n  return answer\n", "\n");
  assert.ok(diagnosticCodes(source).includes("GS2202"));
});

test("rejects an unsupported unit with a source-located diagnostic", () => {
  const source = validSource.replace("duration <= 20s", "duration <= 20fortnights");
  assert.ok(diagnosticCodes(source).includes("GS1204"));
});

test("rejects a statically impossible call budget", () => {
  const source = validSource.replace("tool_calls <= 1", "tool_calls <= 0");
  assert.ok(diagnosticCodes(source).includes("GS2005"));
});

test("reports malformed syntax instead of producing partial IR", () => {
  const source = validSource.replace("record Question {", "record Question");
  assert.ok(diagnosticCodes(source).includes("GS1002"));
});

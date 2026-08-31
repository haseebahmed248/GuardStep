import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const cliPath = fileURLToPath(new URL("../cli/main.js", import.meta.url));
const sourcePath = `${repositoryRoot}examples/document-qa/answer.guard`;
const exampleDirectory = `${repositoryRoot}examples/document-qa`;

const runCli = (argumentsValue: readonly string[], cwd = repositoryRoot) =>
  spawnSync(process.execPath, [cliPath, ...argumentsValue], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });

test("check discovers the only .guard file in the current directory", () => {
  const result = runCli(["check"], exampleDirectory);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /1 workflow\(s\) \[AnswerQuestion\]/);
});

test("compile writes valid versioned IR atomically", () => {
  const directory = mkdtempSync(join(tmpdir(), "guardstep-cli-"));
  try {
    const outputPath = join(directory, "answer.ir.json");
    const result = runCli(["compile", sourcePath, "--out", outputPath]);
    assert.equal(result.status, 0, result.stderr);
    const ir = JSON.parse(readFileSync(outputPath, "utf8")) as { schema_version?: number };
    assert.equal(ir.schema_version, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("test executes all document Q&A scenarios through compiled GuardStep", () => {
  const result = runCli(["test", sourcePath]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /11\/11 scenarios passed\./);
});

test("run discovers conventional source, input, and host files", () => {
  const result = runCli(["run"], exampleDirectory);
  assert.equal(result.status, 0, result.stderr);
  const run = JSON.parse(result.stdout) as { status?: string; output?: { status?: string } };
  assert.equal(run.status, "succeeded");
  assert.equal(run.output?.status, "answered");
});

test("diagnostics are source-located and produce a non-zero exit", () => {
  const directory = mkdtempSync(join(tmpdir(), "guardstep-diagnostic-"));
  try {
    const invalidPath = join(directory, "invalid.guard");
    writeFileSync(invalidPath, "workflow Broken(", "utf8");
    const result = runCli(["check", invalidPath]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /invalid\.guard:1:\d+ GS1002/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

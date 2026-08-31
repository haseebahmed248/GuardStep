import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { compileSource } from "../compiler/index.js";
import { generateTypeScript } from "../codegen/index.js";
import { executeWorkflow } from "../runtime/index.js";
import type { WorkflowHost } from "../runtime/index.js";
import type { GuardTestSuite } from "../testing/index.js";
import { runTestSuite } from "../testing/index.js";
import { readSource, writeFileAtomic } from "./io.js";

export interface CommandContext {
  readonly stdout: (message: string) => void;
  readonly stderr: (message: string) => void;
}

const compilePath = (sourcePath: string) => {
  const input = readSource(sourcePath);
  return { ...input, ir: compileSource(input) };
};

export const checkCommand = (sourcePath: string, context: CommandContext): void => {
  const { ir } = compilePath(sourcePath);
  const workflowNames = ir.workflows.map(({ name }) => name).join(", ");
  context.stdout(`Checked ${sourcePath}: ${ir.workflows.length} workflow(s) [${workflowNames}]`);
};

export const compileCommand = (
  sourcePath: string,
  outputPath: string | undefined,
  context: CommandContext,
): void => {
  const { ir } = compilePath(sourcePath);
  const serialized = `${JSON.stringify(ir, null, 2)}\n`;
  if (outputPath === undefined) context.stdout(serialized.trimEnd());
  else {
    writeFileAtomic(outputPath, serialized);
    context.stdout(`Wrote ${outputPath}`);
  }
};

export const generateCommand = (
  sourcePath: string,
  outputPath: string | undefined,
  check: boolean,
  context: CommandContext,
): void => {
  const { ir } = compilePath(sourcePath);
  const target = resolve(outputPath ?? neighboringPath(sourcePath, ".generated.ts"));
  const generated = generateTypeScript(ir);
  const current = existsSync(target) ? readFileSync(target, "utf8") : undefined;
  if (check) {
    if (current !== generated) {
      throw new Error(`Generated contracts are missing or stale: ${target}`);
    }
    context.stdout(`Generated contracts are current: ${target}`);
    return;
  }
  if (current === generated) {
    context.stdout(`Unchanged ${target}`);
    return;
  }
  writeFileAtomic(target, generated);
  context.stdout(`Wrote ${target}`);
};

const defaultSuitePath = (sourcePath: string): string => {
  const extension = extname(sourcePath);
  return resolve(sourcePath.slice(0, -extension.length) + ".test.mjs");
};

const neighboringPath = (sourcePath: string, suffix: string): string => {
  const extension = extname(sourcePath);
  return resolve(sourcePath.slice(0, -extension.length) + suffix);
};

const loadDefaultExport = async (path: string, purpose: string): Promise<unknown> => {
  const resolved = resolve(path);
  if (!existsSync(resolved)) throw new Error(`${purpose} not found: ${resolved}`);
  const moduleValue = await import(`${pathToFileURL(resolved).href}?v=${Date.now()}`) as {
    readonly default?: unknown;
  };
  if (moduleValue.default === undefined) {
    throw new Error(`${purpose} must have a default export: ${resolved}`);
  }
  return moduleValue.default;
};

const loadSuite = async (path: string): Promise<GuardTestSuite> => {
  const suite = await loadDefaultExport(path, "Test suite");
  if (typeof suite !== "object" || suite === null || !("cases" in suite)) {
    throw new Error(`Test module must default-export a GuardTestSuite: ${resolve(path)}`);
  }
  return suite as GuardTestSuite;
};

const loadHost = async (path: string): Promise<WorkflowHost> => {
  const host = await loadDefaultExport(path, "Host module");
  if (
    typeof host !== "object" ||
    host === null ||
    !("schemaVersion" in host) ||
    host.schemaVersion !== 1 ||
    !("grantedCapabilities" in host) ||
    !Array.isArray(host.grantedCapabilities) ||
    !("pricing" in host) ||
    !("tools" in host) ||
    !("model" in host)
  ) {
    throw new Error(`Host module must default-export a WorkflowHost with schemaVersion 1: ${resolve(path)}`);
  }
  return host as unknown as WorkflowHost;
};

export const runCommand = async (
  sourcePath: string,
  inputPath: string | undefined,
  hostPath: string | undefined,
  requestedWorkflow: string | undefined,
  context: CommandContext,
): Promise<boolean> => {
  const { ir } = compilePath(sourcePath);
  const inputFile = resolve(inputPath ?? neighboringPath(sourcePath, ".input.json"));
  if (!existsSync(inputFile)) throw new Error(`Input file not found: ${inputFile}`);
  let input: unknown;
  try {
    input = JSON.parse(readFileSync(inputFile, "utf8"));
  } catch (error) {
    throw new Error(`Input file is not valid JSON: ${inputFile}`, { cause: error });
  }

  const host = await loadHost(hostPath ?? neighboringPath(sourcePath, ".host.mjs"));
  const workflow = requestedWorkflow ?? host.workflow ?? (
    ir.workflows.length === 1 ? ir.workflows[0]!.name : undefined
  );
  if (workflow === undefined) {
    throw new Error("Multiple workflows are available; select one with --workflow or in the host module");
  }
  const run = await executeWorkflow({
    ir,
    workflow,
    runId: `${workflow}/${randomUUID()}`,
    input,
    grantedCapabilities: new Set(host.grantedCapabilities),
    pricing: host.pricing,
    tools: host.tools,
    model: host.model,
  });
  context.stdout(JSON.stringify(run, null, 2));
  return run.status === "succeeded";
};

export const testCommand = async (
  sourcePath: string,
  suitePath: string | undefined,
  context: CommandContext,
): Promise<boolean> => {
  const { ir } = compilePath(sourcePath);
  const suite = await loadSuite(suitePath ?? defaultSuitePath(resolve(sourcePath)));
  const results = await runTestSuite(ir, suite);
  let failures = 0;
  for (const result of results) {
    if (result.passed) context.stdout(`PASS ${result.id}`);
    else {
      failures += 1;
      context.stderr(`FAIL ${result.id}`);
      for (const failure of result.failures) context.stderr(`  - ${failure}`);
    }
  }
  const passed = results.length - failures;
  context.stdout(`\n${passed}/${results.length} scenarios passed.`);
  return failures === 0;
};

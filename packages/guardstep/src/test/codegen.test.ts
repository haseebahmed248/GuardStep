import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";

import { generateTypeScript, TypeScriptGenerationError } from "../codegen/index.js";
import { compileSource } from "../compiler/index.js";
import type { WorkflowIrV1 } from "../ir/index.js";
import { GUARDSTEP_VERSION } from "../version.js";

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const sourcePath = `${repositoryRoot}examples/document-qa/answer.guard`;
const source = readFileSync(sourcePath, "utf8");
const ir = compileSource({ source, sourcePath });

test("keeps generated provenance aligned with the package version", () => {
  const packageJson = JSON.parse(
    readFileSync(`${repositoryRoot}packages/guardstep/package.json`, "utf8"),
  ) as { readonly version?: string };
  assert.equal(GUARDSTEP_VERSION, packageJson.version);
});

test("generates deterministic portable TypeScript contracts", () => {
  const first = generateTypeScript(ir);
  const second = generateTypeScript(ir);

  assert.equal(first, second);
  assert.match(first, /\/\/ Source: answer\.guard/);
  assert.doesNotMatch(first, new RegExp(repositoryRoot.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")));
  assert.match(first, /export interface Question/);
  assert.match(first, /readonly "documents\.search"|readonly tool: "documents\.search"/);
  assert.match(first, /export interface GuardStepHost/);
  assert.match(first, /readonly failure: FailureCode/);
  assert.match(first, /readonly "documents": ReadonlyArray<Document>/);
  assert.match(first, /readonly value: Answer/);
  assert.equal(first.match(/readonly signal: AbortSignal;/g)?.length, 2);
});

test("rejects declarations that collide with generated API names", () => {
  const conflicting: WorkflowIrV1 = {
    ...ir,
    declarations: {
      ...ir.declarations,
      records: [
        ...ir.declarations.records,
        {
          name: "GuardStepHost",
          fields: [],
          source: ir.workflows[0]!.source,
        },
      ],
    },
  };

  assert.throws(() => generateTypeScript(conflicting), TypeScriptGenerationError);
});

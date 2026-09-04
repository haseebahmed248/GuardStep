import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";

import {
  compileSource,
  formatDiagnostic,
  GuardStepDiagnosticError,
} from "../compiler/index.js";
import {
  diagnosticCorpusDirectory,
  loadDiagnosticCorpus,
} from "./diagnostic-corpus.js";

const cliPath = fileURLToPath(new URL("../cli/main.js", import.meta.url));
const fixtures = loadDiagnosticCorpus();

for (const fixture of fixtures) {
  test(`compiler diagnostic fixture: ${fixture.id}`, () => {
    assert.throws(
      () => compileSource({ source: fixture.source, sourcePath: fixture.file }),
      (error) => {
        assert.ok(error instanceof GuardStepDiagnosticError);
        assert.deepEqual(
          error.diagnostics,
          fixture.diagnostics.map((diagnostic) => ({
            ...diagnostic,
            sourcePath: fixture.file,
          })),
        );
        return true;
      },
    );
  });

  test(`CLI diagnostic fixture: ${fixture.id}`, () => {
    const sourcePath = join(diagnosticCorpusDirectory, fixture.file);
    const result = spawnSync(process.execPath, [cliPath, "check", fixture.file], {
      cwd: diagnosticCorpusDirectory,
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
    });
    const expected = fixture.diagnostics
      .map((diagnostic) => formatDiagnostic({ ...diagnostic, sourcePath }, fixture.source))
      .join("\n");

    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, `${expected}\n`);
    assert.match(result.stderr, new RegExp(`${fixture.file}:\\d+:\\d+ ${fixture.diagnostics[0]!.code}`));
    assert.match(result.stderr, /\n  .+\n  \s*\^+/);
  });
}

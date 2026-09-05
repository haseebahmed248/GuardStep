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
import type { Diagnostic } from "../compiler/index.js";
import {
  diagnosticCorpusDirectory,
  loadDiagnosticCorpus,
} from "./diagnostic-corpus.js";

const cliPath = fileURLToPath(new URL("../cli/main.js", import.meta.url));
const fixtures = loadDiagnosticCorpus();

const formatterCases: readonly {
  name: string;
  source: string;
  range: Diagnostic["range"];
  expected: string;
}[] = [
  {
    name: "formats a single-line diagnostic with a column offset",
    source: "prefix\nabcdef\nx",
    range: {
      start: { line: 2, column: 3, offset: 9 },
      end: { line: 2, column: 5, offset: 11 },
    },
    expected: "example.guard:2:3 GS2202 Invalid value\n  abcdef\n    ^^",
  },
  {
    name: "underlines the first line of a multiline diagnostic with a shorter final line",
    source: "prefix\nabcdef\nx",
    range: {
      start: { line: 2, column: 3, offset: 9 },
      end: { line: 3, column: 2, offset: 15 },
    },
    expected: "example.guard:2:3 GS2202 Invalid value\n  abcdef\n    ^^^^",
  },
  {
    name: "limits a multiline diagnostic marker to the first line with a longer final line",
    source: "prefix\nabcdef\nabcdefghij",
    range: {
      start: { line: 2, column: 3, offset: 9 },
      end: { line: 3, column: 11, offset: 24 },
    },
    expected: "example.guard:2:3 GS2202 Invalid value\n  abcdef\n    ^^^^",
  },
  {
    name: "shows one marker for a multiline diagnostic starting on an empty line",
    source: "a\n\nbc",
    range: {
      start: { line: 2, column: 1, offset: 2 },
      end: { line: 3, column: 3, offset: 5 },
    },
    expected: "example.guard:2:1 GS2202 Invalid value\n  \n  ^",
  },
  {
    name: "shows one marker for an empty range inside a line",
    source: "abcdef",
    range: {
      start: { line: 1, column: 3, offset: 2 },
      end: { line: 1, column: 3, offset: 2 },
    },
    expected: "example.guard:1:3 GS2202 Invalid value\n  abcdef\n    ^",
  },
  {
    name: "shows one marker at EOF without a trailing newline",
    source: "abc",
    range: {
      start: { line: 1, column: 4, offset: 3 },
      end: { line: 1, column: 4, offset: 3 },
    },
    expected: "example.guard:1:4 GS2202 Invalid value\n  abc\n     ^",
  },
  {
    name: "shows one marker at EOF after a trailing newline",
    source: "abc\n",
    range: {
      start: { line: 2, column: 1, offset: 4 },
      end: { line: 2, column: 1, offset: 4 },
    },
    expected: "example.guard:2:1 GS2202 Invalid value\n  \n  ^",
  },
  {
    name: "shows one marker for an empty source",
    source: "",
    range: {
      start: { line: 1, column: 1, offset: 0 },
      end: { line: 1, column: 1, offset: 0 },
    },
    expected: "example.guard:1:1 GS2202 Invalid value\n  \n  ^",
  },
];

for (const { name, source, range, expected } of formatterCases) {
  test(name, () => {
    const diagnostic: Diagnostic = {
      code: "GS2202",
      severity: "error",
      message: "Invalid value",
      sourcePath: "example.guard",
      range,
    };
    assert.equal(formatDiagnostic(diagnostic, source), expected);
  });
}

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

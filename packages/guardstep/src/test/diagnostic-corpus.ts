import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Diagnostic } from "../compiler/index.js";

export interface DiagnosticFixture {
  readonly id: string;
  readonly file: string;
  readonly source: string;
  readonly diagnostics: readonly Omit<Diagnostic, "sourcePath">[];
}

interface DiagnosticManifest {
  readonly schemaVersion: number;
  readonly fixtures: readonly Omit<DiagnosticFixture, "source">[];
}

export const diagnosticCorpusDirectory = fileURLToPath(
  new URL("../../../../fixtures/diagnostics/", import.meta.url),
);

export const loadDiagnosticCorpus = (): readonly DiagnosticFixture[] => {
  const manifestPath = join(diagnosticCorpusDirectory, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as DiagnosticManifest;
  if (manifest.schemaVersion !== 1) {
    throw new Error(`Unsupported diagnostic corpus schema: ${manifest.schemaVersion}`);
  }

  return manifest.fixtures.map((fixture) => ({
    ...fixture,
    source: readFileSync(join(diagnosticCorpusDirectory, fixture.file), "utf8"),
  }));
};

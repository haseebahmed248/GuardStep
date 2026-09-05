import type { SourceRange } from "../ir/index.js";

export type DiagnosticSeverity = "error" | "warning";

export interface Diagnostic {
  readonly code: string;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly sourcePath: string;
  readonly range: SourceRange;
}

export class GuardStepDiagnosticError extends Error {
  constructor(readonly diagnostics: readonly Diagnostic[]) {
    super(`${diagnostics.length} GuardStep diagnostic(s)`);
    this.name = "GuardStepDiagnosticError";
  }
}

export const formatDiagnostic = (diagnostic: Diagnostic, source: string): string => {
  const line = source.split(/\r?\n/)[diagnostic.range.start.line - 1] ?? "";
  const markerWidth = Math.max(
    1,
    diagnostic.range.start.line === diagnostic.range.end.line
      ? diagnostic.range.end.column - diagnostic.range.start.column
      : line.length - diagnostic.range.start.column + 1,
  );
  const marker = `${" ".repeat(Math.max(0, diagnostic.range.start.column - 1))}${"^".repeat(markerWidth)}`;
  return [
    `${diagnostic.sourcePath}:${diagnostic.range.start.line}:${diagnostic.range.start.column} ${diagnostic.code} ${diagnostic.message}`,
    `  ${line}`,
    `  ${marker}`,
  ].join("\n");
};

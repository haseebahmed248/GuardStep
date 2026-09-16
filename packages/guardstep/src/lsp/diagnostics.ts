import { DiagnosticSeverity, type Diagnostic } from "vscode-languageserver/node";

import { compileSource, GuardStepDiagnosticError } from "../compiler/index.js";

// Only source compilation: no file reads, host imports or workflow execution.
export const sourceDiagnostics = (source: string, uri: string): Diagnostic[] => {
  try {
    compileSource({ source, sourcePath: uri });
    return [];
  } catch (error) {
    if (!(error instanceof GuardStepDiagnosticError)) throw error;
    return error.diagnostics.map((diagnostic) => ({
      source: "guardstep",
      code: diagnostic.code,
      message: diagnostic.message,
      severity: diagnostic.severity === "error" ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning,
      range: {
        start: {
          line: diagnostic.range.start.line - 1,
          character: diagnostic.range.start.column - 1,
        },
        end: {
          line: diagnostic.range.end.line - 1,
          character: diagnostic.range.end.column - 1,
        },
      },
    }));
  }
};

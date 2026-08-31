export { compileSource } from "./compiler.js";
export type { CompileOptions } from "./compiler.js";
export {
  formatDiagnostic,
  GuardStepDiagnosticError,
} from "./diagnostics.js";
export type { Diagnostic, DiagnosticSeverity } from "./diagnostics.js";
export { validateIrShape } from "./semantic.js";

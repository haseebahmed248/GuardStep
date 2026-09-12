import { createHash } from "node:crypto";

import type { WorkflowIr, WorkflowIrV1 } from "../ir/index.js";
import { GuardStepDiagnosticError } from "./diagnostics.js";
import { Lexer } from "./lexer.js";
import { Parser } from "./parser.js";
import { SemanticAnalyzer, validateIrShape } from "./semantic.js";

export interface CompileOptions {
  readonly source: string;
  readonly sourcePath: string;
}

export const compileSource = ({ source, sourcePath }: CompileOptions): WorkflowIr => {
  const tokens = new Lexer(source, sourcePath).tokenize();
  const parsed = new Parser(tokens, sourcePath).parse();
  const diagnostics = new SemanticAnalyzer(parsed, sourcePath).analyze();
  if (diagnostics.length > 0) throw new GuardStepDiagnosticError(diagnostics);

  const hasControlFlow = parsed.workflows.some((workflow) =>
    workflow.steps.some((step) => step.kind === "branch" || step.kind === "fail"));
  const common = {
    source: {
      path: sourcePath,
      sha256: `sha256:${createHash("sha256").update(source).digest("hex")}`,
    },
    declarations: {
      enums: parsed.enums,
      records: parsed.records,
      tools: parsed.tools,
    },
    workflows: parsed.workflows,
  };
  // The version-1 cast is safe after excluding all control-flow roots above.
  const ir: WorkflowIr = hasControlFlow
    ? { schema_version: 2, ...common }
    : { schema_version: 1, ...common } as WorkflowIrV1;

  const shapeErrors = validateIrShape(ir);
  if (shapeErrors.length > 0) throw new Error(`Compiler produced invalid IR: ${shapeErrors.join("; ")}`);
  return ir;
};

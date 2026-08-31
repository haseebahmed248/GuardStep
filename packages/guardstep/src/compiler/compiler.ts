import { createHash } from "node:crypto";

import type { WorkflowIrV1 } from "../ir/index.js";
import { GuardStepDiagnosticError } from "./diagnostics.js";
import { Lexer } from "./lexer.js";
import { Parser } from "./parser.js";
import { SemanticAnalyzer, validateIrShape } from "./semantic.js";

export interface CompileOptions {
  readonly source: string;
  readonly sourcePath: string;
}

export const compileSource = ({ source, sourcePath }: CompileOptions): WorkflowIrV1 => {
  const tokens = new Lexer(source, sourcePath).tokenize();
  const parsed = new Parser(tokens, sourcePath).parse();
  const diagnostics = new SemanticAnalyzer(parsed, sourcePath).analyze();
  if (diagnostics.length > 0) throw new GuardStepDiagnosticError(diagnostics);

  const ir: WorkflowIrV1 = {
    schema_version: 1,
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

  const shapeErrors = validateIrShape(ir);
  if (shapeErrors.length > 0) throw new Error(`Compiler produced invalid IR: ${shapeErrors.join("; ")}`);
  return ir;
};

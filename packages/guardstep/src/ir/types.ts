export interface SourcePosition {
  readonly offset: number;
  readonly line: number;
  readonly column: number;
}

export interface SourceRange {
  readonly start: SourcePosition;
  readonly end: SourcePosition;
}

export type PrimitiveTypeName = "String" | "Url";

export type TypeReference =
  | { readonly kind: "named"; readonly name: string }
  | { readonly kind: "list"; readonly element: TypeReference };

export interface EnumDeclaration {
  readonly name: string;
  readonly values: readonly string[];
  readonly source: SourceRange;
}

export interface RecordField {
  readonly name: string;
  readonly type: TypeReference;
}

export interface RecordDeclaration {
  readonly name: string;
  readonly fields: readonly RecordField[];
  readonly source: SourceRange;
}

export interface ToolParameter {
  readonly name: string;
  readonly type: TypeReference;
}

export interface ToolDeclaration {
  readonly name: string;
  readonly parameters: readonly ToolParameter[];
  readonly output: TypeReference;
  readonly source: SourceRange;
}

export type Expression =
  | { readonly kind: "identifier"; readonly name: string }
  | { readonly kind: "literal"; readonly value: string | number | boolean | null }
  | { readonly kind: "member"; readonly target: Expression; readonly property: string }
  | {
      readonly kind: "binary";
      readonly operator: "==" | "!=" | ">" | ">=" | "<" | "<=" | "&&" | "||";
      readonly left: Expression;
      readonly right: Expression;
    }
  | {
      readonly kind: "quantifier";
      readonly operator: "every" | "any";
      readonly collection: Expression;
      readonly parameter: string;
      readonly predicate: Expression;
    };

export interface CapabilityPolicy {
  readonly name: string;
  readonly denied_error: string;
}

export interface WorkflowLimits {
  readonly tool_calls: number;
  readonly model_calls: number;
  readonly duration: {
    readonly maximum_ms: number;
    readonly error: string;
  };
  readonly cost: {
    readonly maximum: number;
    readonly currency: string;
    readonly error: string;
  };
}

export interface ToolStep {
  readonly kind: "tool";
  readonly step_id: string;
  readonly assign: string;
  readonly tool: string;
  readonly arguments: Readonly<Record<string, Expression>>;
  readonly timeout_error: string;
  readonly error_error: string;
  readonly invalid_error: string;
  readonly source: SourceRange;
}

export interface ModelStep {
  readonly kind: "model";
  readonly step_id: string;
  readonly assign: string;
  readonly output_type: string;
  readonly profile: string;
  readonly instructions: string;
  readonly context: Readonly<Record<string, Expression>>;
  readonly error_error: string;
  readonly invalid_error: string;
  readonly source: SourceRange;
}

export interface AssertionStep {
  readonly kind: "assertion";
  readonly step_id: string;
  readonly condition: Expression;
  readonly error: string;
  readonly source: SourceRange;
}

export interface ReturnStep {
  readonly kind: "return";
  readonly step_id: string;
  readonly value: Expression;
  readonly source: SourceRange;
}

export type WorkflowStep = ToolStep | ModelStep | AssertionStep | ReturnStep;

export interface WorkflowDeclaration {
  readonly name: string;
  readonly input: {
    readonly parameter: string;
    readonly type: string;
  };
  readonly output: string;
  readonly failures: string;
  readonly capabilities: readonly CapabilityPolicy[];
  readonly limits: WorkflowLimits;
  readonly steps: readonly WorkflowStep[];
  readonly source: SourceRange;
}

export interface WorkflowIrV1 {
  readonly schema_version: 1;
  readonly source: {
    readonly path: string;
    readonly sha256: string;
  };
  readonly declarations: {
    readonly enums: readonly EnumDeclaration[];
    readonly records: readonly RecordDeclaration[];
    readonly tools: readonly ToolDeclaration[];
  };
  readonly workflows: readonly WorkflowDeclaration[];
}

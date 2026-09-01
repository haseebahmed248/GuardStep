import { basename } from "node:path";

import type {
  Expression,
  ModelStep,
  ToolDeclaration,
  TypeReference,
  WorkflowIrV1,
} from "../ir/index.js";
import { GUARDSTEP_VERSION } from "../version.js";

export class TypeScriptGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TypeScriptGenerationError";
  }
}

const GENERATED_NAMES = new Set([
  "GuardStepCapability",
  "GuardStepHost",
  "GuardStepModelInvocation",
  "GuardStepModelResult",
  "GuardStepToolInvocation",
  "GuardStepToolResult",
  "GuardStepWorkflowContracts",
  "GuardStepWorkflowFailure",
  "GuardStepWorkflowInput",
  "GuardStepWorkflowName",
  "GuardStepWorkflowOutput",
  "__GuardStepPricing",
]);

const TYPESCRIPT_RESERVED_WORDS = new Set([
  "any", "boolean", "break", "case", "catch", "class", "const", "constructor", "continue",
  "debugger", "declare", "default", "delete", "do", "else", "enum", "export", "extends",
  "false", "finally", "for", "from", "function", "get", "if", "implements", "import", "in",
  "infer", "instanceof", "interface", "is", "keyof", "let", "module", "namespace", "never",
  "new", "null", "number", "object", "package", "private", "protected", "public", "readonly",
  "require", "return", "set", "static", "string", "super", "switch", "symbol", "this", "throw",
  "true", "try", "type", "typeof", "undefined", "unique", "unknown", "var", "void", "while",
  "with", "yield",
]);

const renderType = (type: TypeReference): string => {
  if (type.kind === "list") return `ReadonlyArray<${renderType(type.element)}>`;
  if (type.name === "String" || type.name === "Url") return "string";
  return type.name;
};

const pascalCase = (value: string): string =>
  value
    .split(/[^A-Za-z0-9]+/u)
    .filter(Boolean)
    .map((part) => `${part[0]!.toUpperCase()}${part.slice(1)}`)
    .join("");

const toolSymbol = (tool: ToolDeclaration): string => `${pascalCase(tool.name)}Tool`;
const modelSymbol = (workflowName: string, step: ModelStep): string =>
  `${pascalCase(workflowName)}${pascalCase(step.assign)}Model`;

type InferredType =
  | TypeReference
  | { readonly kind: "boolean" }
  | { readonly kind: "number" }
  | { readonly kind: "null" };

const renderInferredType = (type: InferredType): string => {
  if (type.kind === "boolean" || type.kind === "number" || type.kind === "null") return type.kind;
  return renderType(type);
};

const inferExpressionType = (
  expression: Expression,
  environment: ReadonlyMap<string, InferredType>,
  ir: WorkflowIrV1,
): InferredType => {
  if (expression.kind === "identifier") {
    const variable = environment.get(expression.name);
    if (variable !== undefined) return variable;
    const declaration = ir.declarations.enums.find(({ values }) => values.includes(expression.name));
    if (declaration !== undefined) return { kind: "named", name: declaration.name };
    throw new TypeScriptGenerationError(`Cannot infer generated type for '${expression.name}'`);
  }
  if (expression.kind === "literal") {
    if (expression.value === null) return { kind: "null" };
    if (typeof expression.value === "boolean") return { kind: "boolean" };
    if (typeof expression.value === "number") return { kind: "number" };
    return { kind: "named", name: "String" };
  }
  if (expression.kind === "binary" || expression.kind === "quantifier") return { kind: "boolean" };
  const target = inferExpressionType(expression.target, environment, ir);
  if (target.kind === "list" && expression.property === "length") return { kind: "number" };
  if (target.kind === "named") {
    const record = ir.declarations.records.find(({ name }) => name === target.name);
    const field = record?.fields.find(({ name }) => name === expression.property);
    if (field !== undefined) return field.type;
  }
  throw new TypeScriptGenerationError(`Cannot infer generated type for member '${expression.property}'`);
};

interface ModelContract {
  readonly symbol: string;
  readonly step: ModelStep;
  readonly context: Readonly<Record<string, InferredType>>;
}

const collectModelContracts = (ir: WorkflowIrV1): readonly ModelContract[] => {
  const contracts: ModelContract[] = [];
  for (const workflow of ir.workflows) {
    const environment = new Map<string, InferredType>([
      [workflow.input.parameter, { kind: "named", name: workflow.input.type }],
    ]);
    for (const step of workflow.steps) {
      if (step.kind === "tool") {
        const tool = ir.declarations.tools.find(({ name }) => name === step.tool);
        if (tool === undefined) throw new TypeScriptGenerationError(`IR references unknown tool '${step.tool}'`);
        environment.set(step.assign, tool.output);
      } else if (step.kind === "model") {
        contracts.push({
          symbol: modelSymbol(workflow.name, step),
          step,
          context: Object.fromEntries(
            Object.entries(step.context).map(([name, expression]) => [
              name,
              inferExpressionType(expression, environment, ir),
            ]),
          ),
        });
        environment.set(step.assign, { kind: "named", name: step.output_type });
      }
    }
  }
  return contracts;
};

const renderTool = (tool: ToolDeclaration): string => {
  const symbol = toolSymbol(tool);
  const argumentsFields = tool.parameters.length === 0
    ? ""
    : `\n${tool.parameters.map(({ name, type }) => `    readonly ${JSON.stringify(name)}: ${renderType(type)};`).join("\n")}\n  `;
  return `export interface ${symbol}Invocation {
  readonly runId: string;
  readonly stepId: string;
  readonly tool: ${JSON.stringify(tool.name)};
  readonly arguments: {${argumentsFields}};
  readonly signal: AbortSignal;
}

export type ${symbol}Result =
  | {
      readonly status: "succeeded";
      readonly value: ${renderType(tool.output)};
      readonly elapsedMs: number;
      readonly eventData?: Readonly<Record<string, unknown>>;
    }
  | {
      readonly status: "failed";
      readonly kind: "timeout" | "error";
      readonly code?: string;
      readonly elapsedMs: number;
    };`;
};

const renderModel = ({ symbol, step, context }: ModelContract): string => {
  const contextFields = Object.entries(context)
    .map(([name, type]) => `    readonly ${JSON.stringify(name)}: ${renderInferredType(type)};`)
    .join("\n");
  return `export interface ${symbol}Invocation {
  readonly runId: string;
  readonly stepId: ${JSON.stringify(step.step_id)};
  readonly profile: ${JSON.stringify(step.profile)};
  readonly instructions: string;
  readonly context: {
${contextFields}
  };
  readonly outputSchema: Readonly<Record<string, unknown>>;
  readonly signal: AbortSignal;
}

export type ${symbol}Result =
  | {
      readonly status: "succeeded";
      readonly value: ${step.output_type};
      readonly usage: {
        readonly input_tokens: number;
        readonly output_tokens: number;
      };
      readonly elapsedMs: number;
    }
  | {
      readonly status: "failed";
      readonly code: string;
      readonly elapsedMs: number;
    };`;
};

const renderUnion = (values: readonly string[], indent = "  "): string =>
  values.length === 0
    ? "never"
    : `\n${values.map((value) => `${indent}| ${JSON.stringify(value)}`).join("\n")}`;

const validateNames = (ir: WorkflowIrV1, modelContracts: readonly ModelContract[]): void => {
  const declaredNames = [
    ...ir.declarations.enums.map(({ name }) => name),
    ...ir.declarations.records.map(({ name }) => name),
  ];
  for (const name of declaredNames) {
    if (!/^[$A-Z_a-z][$\w]*$/u.test(name) || TYPESCRIPT_RESERVED_WORDS.has(name)) {
      throw new TypeScriptGenerationError(`Declaration '${name}' is not a safe TypeScript type name`);
    }
    if (GENERATED_NAMES.has(name)) {
      throw new TypeScriptGenerationError(`Declaration '${name}' conflicts with a generated contract name`);
    }
  }
  const symbols = new Map<string, string>();
  for (const tool of ir.declarations.tools) {
    const symbol = toolSymbol(tool);
    for (const generatedName of [`${symbol}Invocation`, `${symbol}Result`]) {
      if (declaredNames.includes(generatedName)) {
        throw new TypeScriptGenerationError(
          `Declaration '${generatedName}' conflicts with generated contracts for tool '${tool.name}'`,
        );
      }
    }
    const previous = symbols.get(symbol);
    if (previous !== undefined) {
      throw new TypeScriptGenerationError(
        `Tools '${previous}' and '${tool.name}' both generate the TypeScript symbol '${symbol}'`,
      );
    }
    symbols.set(symbol, tool.name);
  }
  for (const contract of modelContracts) {
    for (const generatedName of [`${contract.symbol}Invocation`, `${contract.symbol}Result`]) {
      if (declaredNames.includes(generatedName)) {
        throw new TypeScriptGenerationError(
          `Declaration '${generatedName}' conflicts with generated model contracts`,
        );
      }
    }
  }
};

export const generateTypeScript = (ir: WorkflowIrV1): string => {
  const modelContracts = collectModelContracts(ir);
  validateNames(ir, modelContracts);
  const lines: string[] = [
    "// Generated by GuardStep. Do not edit manually.",
    `// Generator: GuardStep ${GUARDSTEP_VERSION}`,
    `// Source: ${basename(ir.source.path)}`,
    `// Source SHA-256: ${ir.source.sha256}`,
    "",
    "import type { Pricing as __GuardStepPricing } from \"guardstep/runtime\";",
    "",
  ];

  for (const declaration of ir.declarations.enums) {
    lines.push(`export type ${declaration.name} =${renderUnion(declaration.values)};`, "");
  }
  for (const declaration of ir.declarations.records) {
    lines.push(`export interface ${declaration.name} {`);
    for (const field of declaration.fields) {
      lines.push(`  readonly ${JSON.stringify(field.name)}: ${renderType(field.type)};`);
    }
    lines.push("}", "");
  }
  for (const tool of ir.declarations.tools) lines.push(renderTool(tool), "");
  for (const contract of modelContracts) lines.push(renderModel(contract), "");

  const toolSymbols = ir.declarations.tools.map(toolSymbol);
  const modelSymbols = modelContracts.map(({ symbol }) => symbol);
  lines.push(
    `export type GuardStepToolInvocation = ${toolSymbols.length === 0 ? "never" : toolSymbols.map((name) => `${name}Invocation`).join(" | ")};`,
    `export type GuardStepToolResult = ${toolSymbols.length === 0 ? "never" : toolSymbols.map((name) => `${name}Result`).join(" | ")};`,
    `export type GuardStepModelInvocation = ${modelSymbols.length === 0 ? "never" : modelSymbols.map((name) => `${name}Invocation`).join(" | ")};`,
    `export type GuardStepModelResult = ${modelSymbols.length === 0 ? "never" : modelSymbols.map((name) => `${name}Result`).join(" | ")};`,
    "",
    "export interface GuardStepWorkflowContracts {",
  );
  for (const workflow of ir.workflows) {
    lines.push(`  readonly ${JSON.stringify(workflow.name)}: {`);
    lines.push(`    readonly input: ${workflow.input.type};`);
    lines.push(`    readonly output: ${workflow.output};`);
    lines.push(`    readonly failure: ${workflow.failures};`);
    lines.push("  };");
  }
  lines.push(
    "}",
    "",
    "export type GuardStepWorkflowName = keyof GuardStepWorkflowContracts;",
    "export type GuardStepWorkflowInput<Name extends GuardStepWorkflowName> = GuardStepWorkflowContracts[Name][\"input\"];",
    "export type GuardStepWorkflowOutput<Name extends GuardStepWorkflowName> = GuardStepWorkflowContracts[Name][\"output\"];",
    "export type GuardStepWorkflowFailure<Name extends GuardStepWorkflowName> = GuardStepWorkflowContracts[Name][\"failure\"];",
    "",
  );

  const capabilities = [...new Set(ir.workflows.flatMap(({ capabilities: values }) => values.map(({ name }) => name)))].sort();
  lines.push(
    `export type GuardStepCapability =${renderUnion(capabilities)};`,
    "",
    "export interface GuardStepHost {",
    "  readonly schemaVersion: 1;",
    "  readonly workflow?: GuardStepWorkflowName;",
    "  readonly grantedCapabilities: readonly GuardStepCapability[];",
    "  readonly pricing: __GuardStepPricing;",
    "  readonly tools: {",
    "    invoke(request: GuardStepToolInvocation): Promise<GuardStepToolResult>;",
    "  };",
    "  readonly model: {",
    "    generate(request: GuardStepModelInvocation): Promise<GuardStepModelResult>;",
    "  };",
    "}",
    "",
  );
  return lines.join("\n");
};

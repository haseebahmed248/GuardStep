import type {
  Expression,
  SourceRange,
  TypeReference,
  WorkflowDeclaration,
  WorkflowIrV1,
} from "../ir/index.js";
import type { Diagnostic } from "./diagnostics.js";
import type { ParsedProgram } from "./parser.js";

type InferredType =
  | TypeReference
  | { readonly kind: "boolean" }
  | { readonly kind: "number" }
  | { readonly kind: "unknown" };

const typeKey = (type: InferredType): string => {
  if (type.kind === "list") return `List<${typeKey(type.element)}>`;
  if (type.kind === "named") return type.name;
  return type.kind;
};

const sameType = (left: InferredType, right: InferredType): boolean =>
  left.kind === "unknown" || right.kind === "unknown" || typeKey(left) === typeKey(right);

export class SemanticAnalyzer {
  private readonly diagnostics: Diagnostic[] = [];
  private readonly typeDeclarations = new Map<string, "enum" | "record">();
  private readonly tools = new Map<string, ParsedProgram["tools"][number]>();
  private readonly enumOwners = new Map<string, string[]>();

  constructor(
    private readonly program: ParsedProgram,
    private readonly sourcePath: string,
  ) {}

  analyze(): readonly Diagnostic[] {
    this.collectSymbols();
    this.validateDeclarations();
    for (const workflow of this.program.workflows) this.validateWorkflow(workflow);
    return this.diagnostics;
  }

  private collectSymbols(): void {
    for (const declaration of [...this.program.enums, ...this.program.records]) {
      if (this.typeDeclarations.has(declaration.name)) {
        this.error("GS1101", `Duplicate type declaration '${declaration.name}'`, declaration.source);
      } else {
        this.typeDeclarations.set(
          declaration.name,
          "values" in declaration ? "enum" : "record",
        );
      }
    }

    for (const tool of this.program.tools) {
      if (this.tools.has(tool.name)) this.error("GS1101", `Duplicate tool declaration '${tool.name}'`, tool.source);
      else this.tools.set(tool.name, tool);
    }

    const workflowNames = new Set<string>();
    for (const workflow of this.program.workflows) {
      if (workflowNames.has(workflow.name)) {
        this.error("GS1101", `Duplicate workflow declaration '${workflow.name}'`, workflow.source);
      }
      workflowNames.add(workflow.name);
    }

    for (const declaration of this.program.enums) {
      for (const value of declaration.values) {
        const owners = this.enumOwners.get(value) ?? [];
        owners.push(declaration.name);
        this.enumOwners.set(value, owners);
      }
    }
  }

  private validateDeclarations(): void {
    for (const declaration of this.program.enums) {
      if (declaration.values.length === 0) {
        this.error("GS1201", `Enum '${declaration.name}' must contain at least one value`, declaration.source);
      }
      if (new Set(declaration.values).size !== declaration.values.length) {
        this.error("GS1101", `Enum '${declaration.name}' contains a duplicate value`, declaration.source);
      }
    }

    for (const declaration of this.program.records) {
      const fields = declaration.fields.map(({ name }) => name);
      if (new Set(fields).size !== fields.length) {
        this.error("GS1101", `Record '${declaration.name}' contains a duplicate field`, declaration.source);
      }
      for (const field of declaration.fields) this.validateType(field.type, declaration.source);
    }

    for (const tool of this.program.tools) {
      const parameters = tool.parameters.map(({ name }) => name);
      if (new Set(parameters).size !== parameters.length) {
        this.error("GS1101", `Tool '${tool.name}' contains a duplicate parameter`, tool.source);
      }
      for (const parameter of tool.parameters) this.validateType(parameter.type, tool.source);
      this.validateType(tool.output, tool.source);
    }
  }

  private validateWorkflow(workflow: WorkflowDeclaration): void {
    if (this.typeDeclarations.get(workflow.input.type) !== "record") {
      this.error("GS1202", `Workflow input type '${workflow.input.type}' must be a record`, workflow.source);
    }
    if (this.typeDeclarations.get(workflow.output) !== "record") {
      this.error("GS1202", `Workflow output type '${workflow.output}' must be a record`, workflow.source);
    }
    if (this.typeDeclarations.get(workflow.failures) !== "enum") {
      this.error("GS1202", `Workflow failure type '${workflow.failures}' must be an enum`, workflow.source);
    }

    const failureValues = new Set(
      this.program.enums.find(({ name }) => name === workflow.failures)?.values ?? [],
    );
    const validateFailure = (failure: string, range: SourceRange): void => {
      if (!failureValues.has(failure)) {
        this.error(
          "GS2003",
          `Failure '${failure}' is not declared by ${workflow.failures}`,
          range,
        );
      }
    };

    const capabilityNames = workflow.capabilities.map(({ name }) => name);
    if (new Set(capabilityNames).size !== capabilityNames.length) {
      this.error("GS1101", "Workflow contains a duplicate capability", workflow.source);
    }
    for (const capability of workflow.capabilities) {
      if (!this.tools.has(capability.name)) {
        this.error("GS2001", `Capability references unknown tool '${capability.name}'`, workflow.source);
      }
      validateFailure(capability.denied_error, workflow.source);
    }
    validateFailure(workflow.limits.duration.error, workflow.source);
    validateFailure(workflow.limits.cost.error, workflow.source);
    if (workflow.limits.duration.maximum_ms <= 0) {
      this.error("GS1203", "Duration limit must be greater than zero", workflow.source);
    }
    if (workflow.limits.cost.maximum < 0) {
      this.error("GS1203", "Cost limit cannot be negative", workflow.source);
    }

    const variables = new Map<string, InferredType>([
      [workflow.input.parameter, { kind: "named", name: workflow.input.type }],
    ]);
    let returnCount = 0;
    const toolStepCount = workflow.steps.filter(({ kind }) => kind === "tool").length;
    const modelStepCount = workflow.steps.filter(({ kind }) => kind === "model").length;
    if (toolStepCount > workflow.limits.tool_calls) {
      this.error(
        "GS2005",
        `Workflow declares ${toolStepCount} tool step(s) but tool_calls is ${workflow.limits.tool_calls}`,
        workflow.source,
      );
    }
    if (modelStepCount > workflow.limits.model_calls) {
      this.error(
        "GS2005",
        `Workflow declares ${modelStepCount} model step(s) but model_calls is ${workflow.limits.model_calls}`,
        workflow.source,
      );
    }

    for (const [index, step] of workflow.steps.entries()) {
      if (returnCount > 0) {
        this.error("GS2203", "A workflow cannot contain a step after return", step.source);
      }
      if (step.kind === "tool") {
        const tool = this.tools.get(step.tool);
        if (tool === undefined) {
          this.error("GS2001", `Call references unknown tool '${step.tool}'`, step.source);
        }
        if (!capabilityNames.includes(step.tool)) {
          this.error("GS2002", `Tool '${step.tool}' is called without a declared capability`, step.source);
        }
        validateFailure(step.timeout_error, step.source);
        validateFailure(step.error_error, step.source);
        validateFailure(step.invalid_error, step.source);
        if (variables.has(step.assign)) {
          this.error("GS2103", `Variable '${step.assign}' is already defined`, step.source);
        }
        if (tool !== undefined) {
          const supplied = Object.keys(step.arguments);
          const expected = tool.parameters.map(({ name }) => name);
          for (const name of expected) {
            if (!(name in step.arguments)) this.error("GS2104", `Missing argument '${name}' for ${tool.name}`, step.source);
          }
          for (const name of supplied) {
            if (!expected.includes(name)) this.error("GS2104", `Unknown argument '${name}' for ${tool.name}`, step.source);
          }
          for (const parameter of tool.parameters) {
            const argument = step.arguments[parameter.name];
            if (argument !== undefined) {
              const actual = this.inferExpression(argument, variables, step.source);
              if (!sameType(actual, parameter.type)) {
                this.error(
                  "GS2105",
                  `Argument '${parameter.name}' expects ${typeKey(parameter.type)}, received ${typeKey(actual)}`,
                  step.source,
                );
              }
            }
          }
          variables.set(step.assign, tool.output);
        }
      } else if (step.kind === "model") {
        if (this.typeDeclarations.get(step.output_type) !== "record") {
          this.error("GS1202", `Generated type '${step.output_type}' must be a record`, step.source);
        }
        validateFailure(step.error_error, step.source);
        validateFailure(step.invalid_error, step.source);
        if (variables.has(step.assign)) {
          this.error("GS2103", `Variable '${step.assign}' is already defined`, step.source);
        }
        for (const expression of Object.values(step.context)) {
          this.inferExpression(expression, variables, step.source);
        }
        variables.set(step.assign, { kind: "named", name: step.output_type });
      } else if (step.kind === "assertion") {
        validateFailure(step.error, step.source);
        const condition = this.inferExpression(step.condition, variables, step.source);
        if (condition.kind !== "boolean" && condition.kind !== "unknown") {
          this.error("GS2201", `Assertion must be boolean, received ${typeKey(condition)}`, step.source);
        }
      } else {
        returnCount += 1;
        const returned = this.inferExpression(step.value, variables, step.source);
        const expected: TypeReference = { kind: "named", name: workflow.output };
        if (!sameType(returned, expected)) {
          this.error(
            "GS2202",
            `Workflow returns ${typeKey(returned)}, expected ${workflow.output}`,
            step.source,
          );
        }
        if (index !== workflow.steps.length - 1) {
          this.error("GS2203", "Return must be the final workflow step", step.source);
        }
      }
    }

    if (returnCount === 0) this.error("GS2202", `Workflow '${workflow.name}' has no return`, workflow.source);
    if (returnCount > 1) this.error("GS2202", `Workflow '${workflow.name}' has multiple returns`, workflow.source);
  }

  private inferExpression(
    expression: Expression,
    variables: ReadonlyMap<string, InferredType>,
    range: SourceRange,
  ): InferredType {
    if (expression.kind === "literal") {
      if (typeof expression.value === "number") return { kind: "number" };
      if (typeof expression.value === "boolean") return { kind: "boolean" };
      return { kind: "named", name: "String" };
    }
    if (expression.kind === "identifier") {
      const variable = variables.get(expression.name);
      if (variable !== undefined) return variable;
      const owners = this.enumOwners.get(expression.name) ?? [];
      if (owners.length === 1) return { kind: "named", name: owners[0]! };
      if (owners.length > 1) {
        this.error("GS2102", `Enum value '${expression.name}' is ambiguous`, range);
      } else {
        this.error("GS2101", `Unknown identifier '${expression.name}'`, range);
      }
      return { kind: "unknown" };
    }
    if (expression.kind === "member") {
      const target = this.inferExpression(expression.target, variables, range);
      if (expression.property === "length" && target.kind === "list") return { kind: "number" };
      if (target.kind === "named") {
        const record = this.program.records.find(({ name }) => name === target.name);
        const field = record?.fields.find(({ name }) => name === expression.property);
        if (field !== undefined) return field.type;
      }
      this.error("GS2102", `Type '${typeKey(target)}' has no field '${expression.property}'`, range);
      return { kind: "unknown" };
    }
    if (expression.kind === "quantifier") {
      const collection = this.inferExpression(expression.collection, variables, range);
      if (collection.kind !== "list") {
        this.error("GS2105", `${expression.operator} requires a list`, range);
        return { kind: "unknown" };
      }
      const nested = new Map(variables);
      nested.set(expression.parameter, collection.element);
      const predicate = this.inferExpression(expression.predicate, nested, range);
      if (predicate.kind !== "boolean" && predicate.kind !== "unknown") {
        this.error("GS2105", `${expression.operator} predicate must be boolean`, range);
      }
      return { kind: "boolean" };
    }

    const left = this.inferExpression(expression.left, variables, range);
    if (expression.operator === "&&" || expression.operator === "||") {
      const right = this.inferExpression(expression.right, variables, range);
      if (left.kind !== "boolean" && left.kind !== "unknown") {
        this.error("GS2105", `${expression.operator} requires boolean operands`, range);
      }
      if (right.kind !== "boolean" && right.kind !== "unknown") {
        this.error("GS2105", `${expression.operator} requires boolean operands`, range);
      }
      return { kind: "boolean" };
    }
    const right = this.inferExpression(expression.right, variables, range);
    if (!sameType(left, right)) {
      this.error(
        "GS2105",
        `Cannot compare ${typeKey(left)} with ${typeKey(right)}`,
        range,
      );
    }
    return { kind: "boolean" };
  }

  private validateType(type: TypeReference, range: SourceRange): void {
    if (type.kind === "list") {
      this.validateType(type.element, range);
      return;
    }
    if (!["String", "Url"].includes(type.name) && !this.typeDeclarations.has(type.name)) {
      this.error("GS1201", `Unknown type '${type.name}'`, range);
    }
  }

  private error(code: string, message: string, range: SourceRange): void {
    this.diagnostics.push({
      code,
      severity: "error",
      message,
      sourcePath: this.sourcePath,
      range,
    });
  }
}

export const validateIrShape = (ir: WorkflowIrV1): readonly string[] => {
  const errors: string[] = [];
  if (ir.schema_version !== 1) errors.push("schema_version must be 1");
  if (ir.workflows.length === 0) errors.push("IR must contain at least one workflow");
  if (!/^sha256:[0-9a-f]{64}$/.test(ir.source.sha256)) errors.push("source.sha256 is invalid");
  return errors;
};

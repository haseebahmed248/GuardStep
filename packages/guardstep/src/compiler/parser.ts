import type {
  AssertionStep,
  CapabilityPolicy,
  EnumDeclaration,
  Expression,
  ModelStep,
  RecordDeclaration,
  ReturnStep,
  SourceRange,
  ToolDeclaration,
  ToolStep,
  TypeReference,
  WorkflowDeclaration,
  WorkflowLimits,
  WorkflowStep,
} from "../ir/index.js";
import type { Diagnostic } from "./diagnostics.js";
import { GuardStepDiagnosticError } from "./diagnostics.js";
import type { Token, TokenKind } from "./lexer.js";

export interface ParsedProgram {
  readonly enums: readonly EnumDeclaration[];
  readonly records: readonly RecordDeclaration[];
  readonly tools: readonly ToolDeclaration[];
  readonly workflows: readonly WorkflowDeclaration[];
}

export class Parser {
  private index = 0;

  constructor(
    private readonly tokens: readonly Token[],
    private readonly sourcePath: string,
  ) {}

  parse(): ParsedProgram {
    const enums: EnumDeclaration[] = [];
    const records: RecordDeclaration[] = [];
    const tools: ToolDeclaration[] = [];
    const workflows: WorkflowDeclaration[] = [];

    while (!this.checkKind("eof")) {
      if (this.matchValue("enum")) enums.push(this.parseEnum(this.previous()));
      else if (this.matchValue("record")) records.push(this.parseRecord(this.previous()));
      else if (this.matchValue("tool")) tools.push(this.parseTool(this.previous()));
      else if (this.matchValue("workflow")) workflows.push(this.parseWorkflow(this.previous()));
      else this.fail(this.current(), "GS1002", "Expected enum, record, tool, or workflow declaration");
    }

    return { enums, records, tools, workflows };
  }

  private parseEnum(start: Token): EnumDeclaration {
    const name = this.consumeKind("identifier", "Expected enum name");
    this.consumeValue("{", "Expected '{' after enum name");
    const values: string[] = [];
    while (!this.checkValue("}")) {
      values.push(this.consumeKind("identifier", "Expected enum value").value);
      this.matchValue(",");
    }
    const end = this.consumeValue("}", "Expected '}' after enum values");
    return { name: name.value, values, source: this.range(start, end) };
  }

  private parseRecord(start: Token): RecordDeclaration {
    const name = this.consumeKind("identifier", "Expected record name");
    this.consumeValue("{", "Expected '{' after record name");
    const fields: { name: string; type: TypeReference }[] = [];
    while (!this.checkValue("}")) {
      const field = this.consumeKind("identifier", "Expected field name");
      this.consumeValue(":", "Expected ':' after field name");
      fields.push({ name: field.value, type: this.parseTypeReference() });
      this.matchValue(",");
    }
    const end = this.consumeValue("}", "Expected '}' after record fields");
    return { name: name.value, fields, source: this.range(start, end) };
  }

  private parseTool(start: Token): ToolDeclaration {
    const name = this.parseQualifiedName();
    this.consumeValue("(", "Expected '(' after tool name");
    const parameters: { name: string; type: TypeReference }[] = [];
    while (!this.checkValue(")")) {
      const parameter = this.consumeKind("identifier", "Expected parameter name");
      this.consumeValue(":", "Expected ':' after parameter name");
      parameters.push({ name: parameter.value, type: this.parseTypeReference() });
      if (!this.matchValue(",")) break;
    }
    this.consumeValue(")", "Expected ')' after tool parameters");
    this.consumeValue("->", "Expected '->' before tool output type");
    const output = this.parseTypeReference();
    return { name, parameters, output, source: this.range(start, this.previous()) };
  }

  private parseWorkflow(start: Token): WorkflowDeclaration {
    const name = this.consumeKind("identifier", "Expected workflow name");
    this.consumeValue("(", "Expected '(' after workflow name");
    const inputParameter = this.consumeKind("identifier", "Expected workflow input parameter");
    this.consumeValue(":", "Expected ':' after workflow input parameter");
    const inputType = this.consumeKind("identifier", "Expected workflow input type");
    this.consumeValue(")", "Expected ')' after workflow input");
    this.consumeValue("->", "Expected '->' before workflow output type");
    const output = this.consumeKind("identifier", "Expected workflow output type");
    this.consumeValue("fails", "Expected 'fails' before failure enum");
    const failures = this.consumeKind("identifier", "Expected workflow failure enum");
    this.consumeValue("{", "Expected '{' before workflow body");

    let capabilities: readonly CapabilityPolicy[] | undefined;
    let limits: WorkflowLimits | undefined;
    const steps: WorkflowStep[] = [];

    while (!this.checkValue("}")) {
      if (this.matchValue("capabilities")) {
        if (capabilities !== undefined) this.fail(this.previous(), "GS1003", "Duplicate capabilities block");
        capabilities = this.parseCapabilities();
      } else if (this.matchValue("limits")) {
        if (limits !== undefined) this.fail(this.previous(), "GS1003", "Duplicate limits block");
        limits = this.parseLimits();
      } else if (this.matchValue("require")) {
        steps.push(this.parseAssertion(this.previous()));
      } else if (this.matchValue("return")) {
        steps.push(this.parseReturn(this.previous()));
      } else if (this.checkKind("identifier") && this.peek(1).value === "=") {
        steps.push(this.parseAssignment());
      } else {
        this.fail(this.current(), "GS1004", "Expected workflow policy block or step");
      }
    }

    const end = this.consumeValue("}", "Expected '}' after workflow body");
    if (capabilities === undefined) this.fail(name, "GS1005", "Workflow requires a capabilities block");
    if (limits === undefined) this.fail(name, "GS1005", "Workflow requires a limits block");

    return {
      name: name.value,
      input: { parameter: inputParameter.value, type: inputType.value },
      output: output.value,
      failures: failures.value,
      capabilities,
      limits,
      steps,
      source: this.range(start, end),
    };
  }

  private parseCapabilities(): readonly CapabilityPolicy[] {
    this.consumeValue("{", "Expected '{' after capabilities");
    const capabilities: CapabilityPolicy[] = [];
    while (!this.checkValue("}")) {
      const name = this.parseQualifiedName();
      this.consumeValue("else", "Expected 'else' after capability name");
      const denied = this.consumeKind("identifier", "Expected capability denial code");
      capabilities.push({ name, denied_error: denied.value });
      this.matchValue(",");
    }
    this.consumeValue("}", "Expected '}' after capabilities");
    return capabilities;
  }

  private parseLimits(): WorkflowLimits {
    this.consumeValue("{", "Expected '{' after limits");
    let toolCalls: number | undefined;
    let modelCalls: number | undefined;
    let duration: WorkflowLimits["duration"] | undefined;
    let cost: WorkflowLimits["cost"] | undefined;

    while (!this.checkValue("}")) {
      const limit = this.consumeKind("identifier", "Expected limit name");
      this.consumeValue("<=", "Expected '<=' after limit name");
      const maximum = Number(this.consumeKind("number", "Expected numeric limit").value);
      if (limit.value === "tool_calls") toolCalls = maximum;
      else if (limit.value === "model_calls") modelCalls = maximum;
      else if (limit.value === "duration") {
        const unit = this.consumeKind("identifier", "Expected duration unit");
        this.consumeValue("else", "Expected 'else' after duration limit");
        const error = this.consumeKind("identifier", "Expected duration failure code");
        const multiplier = ({ ms: 1, s: 1_000, m: 60_000 } as const)[unit.value as "ms" | "s" | "m"];
        if (multiplier === undefined) this.fail(unit, "GS1204", `Unsupported duration unit '${unit.value}'`);
        duration = { maximum_ms: maximum * multiplier, error: error.value };
      } else if (limit.value === "cost") {
        const currency = this.consumeKind("identifier", "Expected cost currency");
        this.consumeValue("else", "Expected 'else' after cost limit");
        const error = this.consumeKind("identifier", "Expected cost failure code");
        cost = { maximum, currency: currency.value, error: error.value };
      } else {
        this.fail(limit, "GS1203", `Unknown limit '${limit.value}'`);
      }
    }
    this.consumeValue("}", "Expected '}' after limits");

    if (toolCalls === undefined || modelCalls === undefined || duration === undefined || cost === undefined) {
      this.fail(this.previous(), "GS1203", "Limits must declare tool_calls, model_calls, duration, and cost");
    }
    if (!Number.isInteger(toolCalls) || toolCalls < 0 || !Number.isInteger(modelCalls) || modelCalls < 0) {
      this.fail(this.previous(), "GS1203", "Call limits must be non-negative integers");
    }
    return { tool_calls: toolCalls, model_calls: modelCalls, duration, cost };
  }

  private parseAssignment(): ToolStep | ModelStep {
    const assign = this.consumeKind("identifier", "Expected assignment name");
    this.consumeValue("=", "Expected '=' after assignment name");
    if (this.matchValue("call")) return this.parseToolStep(assign);
    if (this.matchValue("generate")) return this.parseModelStep(assign);
    this.fail(this.current(), "GS1006", "Assignment must call a tool or generate a model value");
  }

  private parseToolStep(assign: Token): ToolStep {
    const start = assign;
    const tool = this.parseQualifiedName();
    this.consumeValue("(", "Expected '(' after tool name");
    const argumentsMap: Record<string, Expression> = {};
    while (!this.checkValue(")")) {
      const name = this.consumeKind("identifier", "Expected tool argument name");
      this.consumeValue(":", "Expected ':' after tool argument name");
      argumentsMap[name.value] = this.parseExpression();
      if (!this.matchValue(",")) break;
    }
    this.consumeValue(")", "Expected ')' after tool arguments");
    this.consumeValue("on", "Expected 'on timeout' after tool call");
    this.consumeValue("timeout", "Expected timeout failure mapping");
    this.consumeValue("=>", "Expected '=>' after timeout");
    this.consumeValue("fail", "Expected 'fail' after timeout mapping");
    const timeoutFailure = this.consumeKind("identifier", "Expected timeout failure code");
    this.consumeValue("on", "Expected 'on error' after timeout mapping");
    this.consumeValue("error", "Expected tool-error failure mapping");
    this.consumeValue("=>", "Expected '=>' after error");
    this.consumeValue("fail", "Expected 'fail' after error mapping");
    const callFailure = this.consumeKind("identifier", "Expected tool-error failure code");
    this.consumeValue("on", "Expected 'on invalid' after timeout mapping");
    this.consumeValue("invalid", "Expected invalid-output failure mapping");
    this.consumeValue("=>", "Expected '=>' after invalid");
    this.consumeValue("fail", "Expected 'fail' after invalid mapping");
    const invalidFailure = this.consumeKind("identifier", "Expected invalid-output failure code");
    return {
      kind: "tool",
      step_id: `tool:${tool}`,
      assign: assign.value,
      tool,
      arguments: argumentsMap,
      timeout_error: timeoutFailure.value,
      error_error: callFailure.value,
      invalid_error: invalidFailure.value,
      source: this.range(start, invalidFailure),
    };
  }

  private parseModelStep(assign: Token): ModelStep {
    const start = assign;
    const outputType = this.consumeKind("identifier", "Expected generated output type");
    this.consumeValue("using", "Expected 'using model(...)'");
    this.consumeValue("model", "Expected model profile");
    this.consumeValue("(", "Expected '(' after model");
    const profile = this.consumeKind("string", "Expected quoted model profile");
    this.consumeValue(")", "Expected ')' after model profile");
    this.consumeValue("{", "Expected '{' before model request");
    this.consumeValue("instructions", "Expected instructions field");
    this.consumeValue(":", "Expected ':' after instructions");
    const instructions = this.consumeKind("string", "Expected instruction string");
    this.consumeValue("context", "Expected context field");
    this.consumeValue(":", "Expected ':' after context");
    this.consumeValue("{", "Expected '{' before model context");
    const context: Record<string, Expression> = {};
    while (!this.checkValue("}")) {
      const name = this.consumeKind("identifier", "Expected context field name");
      this.consumeValue(":", "Expected ':' after context field name");
      context[name.value] = this.parseExpression();
      this.matchValue(",");
    }
    this.consumeValue("}", "Expected '}' after model context");
    this.consumeValue("}", "Expected '}' after model request");
    this.consumeValue("on", "Expected 'on error' after model request");
    this.consumeValue("error", "Expected model-error failure mapping");
    this.consumeValue("=>", "Expected '=>' after error");
    this.consumeValue("fail", "Expected 'fail' after error mapping");
    const callFailure = this.consumeKind("identifier", "Expected model-error failure code");
    this.consumeValue("on", "Expected 'on invalid' after model request");
    this.consumeValue("invalid", "Expected invalid-output failure mapping");
    this.consumeValue("=>", "Expected '=>' after invalid");
    this.consumeValue("fail", "Expected 'fail' after invalid mapping");
    const failure = this.consumeKind("identifier", "Expected invalid-output failure code");
    return {
      kind: "model",
      step_id: `model:${profile.value}`,
      assign: assign.value,
      output_type: outputType.value,
      profile: profile.value,
      instructions: instructions.value,
      context,
      error_error: callFailure.value,
      invalid_error: failure.value,
      source: this.range(start, failure),
    };
  }

  private parseAssertion(start: Token): AssertionStep {
    const condition = this.parseExpression();
    this.consumeValue("else", "Expected 'else' after assertion condition");
    const failure = this.consumeKind("identifier", "Expected assertion failure code");
    return {
      kind: "assertion",
      step_id: `assertion:${failure.value}`,
      condition,
      error: failure.value,
      source: this.range(start, failure),
    };
  }

  private parseReturn(start: Token): ReturnStep {
    const value = this.parseExpression();
    return {
      kind: "return",
      step_id: "return:result",
      value,
      source: this.range(start, this.previous()),
    };
  }

  private parseExpression(): Expression {
    return this.parseOr();
  }

  private parseOr(): Expression {
    let expression = this.parseAnd();
    while (this.matchValue("||")) {
      expression = { kind: "binary", operator: "||", left: expression, right: this.parseAnd() };
    }
    return expression;
  }

  private parseAnd(): Expression {
    let expression = this.parseComparison();
    while (this.matchValue("&&")) {
      expression = { kind: "binary", operator: "&&", left: expression, right: this.parseComparison() };
    }
    return expression;
  }

  private parseComparison(): Expression {
    let expression = this.parsePostfix();
    while (["==", "!=", ">", ">=", "<", "<="].includes(this.current().value)) {
      const operator = this.advance().value as "==" | "!=" | ">" | ">=" | "<" | "<=";
      expression = { kind: "binary", operator, left: expression, right: this.parsePostfix() };
    }
    return expression;
  }

  private parsePostfix(): Expression {
    let expression = this.parsePrimary();
    while (this.matchValue(".")) {
      const property = this.consumeKind("identifier", "Expected member name after '.'");
      if (["every", "any"].includes(property.value) && this.matchValue("(")) {
        const parameter = this.consumeKind("identifier", "Expected lambda parameter");
        this.consumeValue("=>", "Expected '=>' after lambda parameter");
        const predicate = this.parseExpression();
        this.consumeValue(")", "Expected ')' after lambda predicate");
        expression = {
          kind: "quantifier",
          operator: property.value as "every" | "any",
          collection: expression,
          parameter: parameter.value,
          predicate,
        };
      } else {
        expression = { kind: "member", target: expression, property: property.value };
      }
    }
    return expression;
  }

  private parsePrimary(): Expression {
    if (this.matchKind("number")) return { kind: "literal", value: Number(this.previous().value) };
    if (this.matchKind("string")) return { kind: "literal", value: this.previous().value };
    if (this.matchValue("true")) return { kind: "literal", value: true };
    if (this.matchValue("false")) return { kind: "literal", value: false };
    if (this.matchValue("null")) return { kind: "literal", value: null };
    if (this.matchValue("(")) {
      const expression = this.parseExpression();
      this.consumeValue(")", "Expected ')' after expression");
      return expression;
    }
    const identifier = this.consumeKind("identifier", "Expected expression");
    return { kind: "identifier", name: identifier.value };
  }

  private parseTypeReference(): TypeReference {
    const name = this.consumeKind("identifier", "Expected type name");
    if (name.value !== "List") return { kind: "named", name: name.value };
    this.consumeValue("<", "Expected '<' after List");
    const element = this.parseTypeReference();
    this.consumeValue(">", "Expected '>' after list element type");
    return { kind: "list", element };
  }

  private parseQualifiedName(): string {
    let name = this.consumeKind("identifier", "Expected name").value;
    while (this.matchValue(".")) {
      name += `.${this.consumeKind("identifier", "Expected name after '.'").value}`;
    }
    return name;
  }

  private range(start: Token, end: Token): SourceRange {
    return { start: start.range.start, end: end.range.end };
  }

  private current(): Token {
    return this.tokens[this.index] ?? this.tokens[this.tokens.length - 1]!;
  }

  private previous(): Token {
    return this.tokens[Math.max(0, this.index - 1)]!;
  }

  private peek(distance: number): Token {
    return this.tokens[Math.min(this.tokens.length - 1, this.index + distance)]!;
  }

  private advance(): Token {
    const token = this.current();
    if (token.kind !== "eof") this.index += 1;
    return token;
  }

  private checkKind(kind: TokenKind): boolean {
    return this.current().kind === kind;
  }

  private checkValue(value: string): boolean {
    return this.current().value === value;
  }

  private matchKind(kind: TokenKind): boolean {
    if (!this.checkKind(kind)) return false;
    this.advance();
    return true;
  }

  private matchValue(value: string): boolean {
    if (!this.checkValue(value)) return false;
    this.advance();
    return true;
  }

  private consumeKind(kind: TokenKind, message: string): Token {
    if (this.checkKind(kind)) return this.advance();
    this.fail(this.current(), "GS1002", message);
  }

  private consumeValue(value: string, message: string): Token {
    if (this.checkValue(value)) return this.advance();
    this.fail(this.current(), "GS1002", message);
  }

  private fail(token: Token, code: string, message: string): never {
    const diagnostic: Diagnostic = {
      code,
      severity: "error",
      message,
      sourcePath: this.sourcePath,
      range: token.range,
    };
    throw new GuardStepDiagnosticError([diagnostic]);
  }
}

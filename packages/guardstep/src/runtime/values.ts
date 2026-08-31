import type {
  EnumDeclaration,
  Expression,
  RecordDeclaration,
  TypeReference,
  WorkflowIrV1,
} from "../ir/index.js";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export interface ValidationResult {
  readonly valid: boolean;
  readonly issues: readonly string[];
}

export class ValueSystem {
  private readonly records = new Map<string, RecordDeclaration>();
  private readonly enums = new Map<string, EnumDeclaration>();
  private readonly enumValues = new Set<string>();

  constructor(ir: WorkflowIrV1) {
    for (const record of ir.declarations.records) this.records.set(record.name, record);
    for (const declaration of ir.declarations.enums) {
      this.enums.set(declaration.name, declaration);
      for (const value of declaration.values) this.enumValues.add(value);
    }
  }

  validate(value: unknown, type: TypeReference): ValidationResult {
    const issues: string[] = [];
    this.validateAt(value, type, "$", issues);
    return { valid: issues.length === 0, issues };
  }

  schema(type: TypeReference): Readonly<Record<string, unknown>> {
    const definitions: Record<string, unknown> = {};
    const visited = new Set<string>();
    const build = (reference: TypeReference): Record<string, unknown> => {
      if (reference.kind === "list") return { type: "array", items: build(reference.element) };
      if (reference.name === "String") return { type: "string" };
      if (reference.name === "Url") return { type: "string", format: "uri" };
      const enumDeclaration = this.enums.get(reference.name);
      if (enumDeclaration !== undefined) return { enum: [...enumDeclaration.values] };
      const record = this.records.get(reference.name);
      if (record === undefined) throw new Error(`Unknown IR type: ${reference.name}`);
      if (!visited.has(record.name)) {
        visited.add(record.name);
        definitions[record.name] = {
          type: "object",
          additionalProperties: false,
          required: record.fields.map(({ name }) => name),
          properties: Object.fromEntries(record.fields.map((field) => [field.name, build(field.type)])),
        };
      }
      return { $ref: `#/$defs/${record.name}` };
    };

    const root = build(type);
    return Object.keys(definitions).length === 0 ? root : { ...root, $defs: definitions };
  }

  evaluate(expression: Expression, environment: ReadonlyMap<string, unknown>): unknown {
    if (expression.kind === "literal") return expression.value;
    if (expression.kind === "identifier") {
      if (environment.has(expression.name)) return environment.get(expression.name);
      if (this.enumValues.has(expression.name)) return expression.name;
      throw new Error(`Unresolved expression identifier: ${expression.name}`);
    }
    if (expression.kind === "member") {
      const target = this.evaluate(expression.target, environment);
      if (expression.property === "length" && (Array.isArray(target) || typeof target === "string")) {
        return target.length;
      }
      if (!isObject(target) || !(expression.property in target)) {
        throw new Error(`Cannot read member ${expression.property}`);
      }
      return target[expression.property];
    }
    if (expression.kind === "quantifier") {
      const collection = this.evaluate(expression.collection, environment);
      if (!Array.isArray(collection)) throw new Error(`${expression.operator} target is not an array`);
      const evaluateItem = (item: unknown): boolean => {
        const nested = new Map(environment);
        nested.set(expression.parameter, item);
        return this.requireBoolean(this.evaluate(expression.predicate, nested));
      };
      return expression.operator === "every"
        ? collection.every(evaluateItem)
        : collection.some(evaluateItem);
    }

    if (expression.operator === "&&") {
      const left = this.requireBoolean(this.evaluate(expression.left, environment));
      return left && this.requireBoolean(this.evaluate(expression.right, environment));
    }
    if (expression.operator === "||") {
      const left = this.requireBoolean(this.evaluate(expression.left, environment));
      return left || this.requireBoolean(this.evaluate(expression.right, environment));
    }
    const left = this.evaluate(expression.left, environment);
    const right = this.evaluate(expression.right, environment);
    if (expression.operator === "==") return left === right;
    if (expression.operator === "!=") return left !== right;
    if (expression.operator === ">") return this.comparable(left) > this.comparable(right);
    if (expression.operator === ">=") return this.comparable(left) >= this.comparable(right);
    if (expression.operator === "<") return this.comparable(left) < this.comparable(right);
    return this.comparable(left) <= this.comparable(right);
  }

  requireBoolean(value: unknown): boolean {
    if (typeof value !== "boolean") throw new Error("Expression did not evaluate to boolean");
    return value;
  }

  private validateAt(value: unknown, type: TypeReference, path: string, issues: string[]): void {
    if (type.kind === "list") {
      if (!Array.isArray(value)) {
        issues.push(`${path} must be an array`);
        return;
      }
      value.forEach((item, index) => this.validateAt(item, type.element, `${path}[${index}]`, issues));
      return;
    }
    if (type.name === "String") {
      if (typeof value !== "string") issues.push(`${path} must be a string`);
      return;
    }
    if (type.name === "Url") {
      if (typeof value !== "string") {
        issues.push(`${path} must be a URL string`);
        return;
      }
      try {
        const url = new URL(value);
        if (url.protocol.length === 0) issues.push(`${path} must be an absolute URL`);
      } catch {
        issues.push(`${path} must be an absolute URL`);
      }
      return;
    }
    const enumDeclaration = this.enums.get(type.name);
    if (enumDeclaration !== undefined) {
      if (typeof value !== "string" || !enumDeclaration.values.includes(value)) {
        issues.push(`${path} must be one of ${enumDeclaration.values.join(", ")}`);
      }
      return;
    }
    const record = this.records.get(type.name);
    if (record === undefined) {
      issues.push(`${path} references unknown type ${type.name}`);
      return;
    }
    if (!isObject(value)) {
      issues.push(`${path} must be an object`);
      return;
    }
    const expected = new Set(record.fields.map(({ name }) => name));
    for (const key of Object.keys(value)) {
      if (!expected.has(key)) issues.push(`${path}.${key} is not allowed`);
    }
    for (const field of record.fields) {
      if (!(field.name in value)) issues.push(`${path}.${field.name} is required`);
      else this.validateAt(value[field.name], field.type, `${path}.${field.name}`, issues);
    }
  }

  private comparable(value: unknown): number | string {
    if (typeof value === "number" || typeof value === "string") return value;
    throw new Error("Relational comparison requires numbers or strings");
  }
}

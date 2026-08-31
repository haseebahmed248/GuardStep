import type { SourcePosition, SourceRange } from "../ir/index.js";
import type { Diagnostic } from "./diagnostics.js";
import { GuardStepDiagnosticError } from "./diagnostics.js";

export type TokenKind = "identifier" | "number" | "string" | "symbol" | "eof";

export interface Token {
  readonly kind: TokenKind;
  readonly value: string;
  readonly range: SourceRange;
}

const symbolCandidates = ["->", "=>", "<=", ">=", "!=", "==", "||", "&&"] as const;
const singleSymbols = new Set(["{", "}", "(", ")", ":", ",", "<", ">", ".", "="]);

const dedentBlock = (value: string): string => {
  const lines = value.replace(/^\r?\n/, "").replace(/\r?\n[\t ]*$/, "").split(/\r?\n/);
  const nonEmpty = lines.filter((line) => line.trim().length > 0);
  const indentation = nonEmpty.length === 0
    ? 0
    : Math.min(...nonEmpty.map((line) => line.match(/^[\t ]*/)?.[0].length ?? 0));
  return lines.map((line) => line.slice(Math.min(indentation, line.length))).join("\n");
};

export class Lexer {
  private offset = 0;
  private line = 1;
  private column = 1;

  constructor(
    private readonly source: string,
    private readonly sourcePath: string,
  ) {}

  tokenize(): readonly Token[] {
    const tokens: Token[] = [];
    while (!this.atEnd()) {
      this.skipTrivia();
      if (this.atEnd()) break;
      tokens.push(this.readToken());
    }
    const position = this.position();
    tokens.push({ kind: "eof", value: "", range: { start: position, end: position } });
    return tokens;
  }

  private readToken(): Token {
    const start = this.position();
    const current = this.peek();

    if (/[A-Za-z_]/.test(current)) {
      let value = "";
      while (!this.atEnd() && /[A-Za-z0-9_]/.test(this.peek())) value += this.advance();
      return this.token("identifier", value, start);
    }

    if (/[0-9]/.test(current)) {
      let value = "";
      while (!this.atEnd() && /[0-9]/.test(this.peek())) value += this.advance();
      if (this.peek() === "." && /[0-9]/.test(this.peek(1))) {
        value += this.advance();
        while (!this.atEnd() && /[0-9]/.test(this.peek())) value += this.advance();
      }
      return this.token("number", value, start);
    }

    if (this.source.startsWith('"""', this.offset)) {
      this.advanceMany(3);
      let value = "";
      while (!this.atEnd() && !this.source.startsWith('"""', this.offset)) {
        value += this.advance();
      }
      if (this.atEnd()) this.fail("GS1001", "Unterminated triple-quoted string", start);
      this.advanceMany(3);
      return this.token("string", dedentBlock(value), start);
    }

    if (current === '"') {
      this.advance();
      let value = "";
      while (!this.atEnd() && this.peek() !== '"') {
        if (this.peek() === "\n" || this.peek() === "\r") {
          this.fail("GS1001", "Unterminated string literal", start);
        }
        if (this.peek() === "\\") {
          this.advance();
          const escaped = this.advance();
          const decoded = ({ n: "\n", r: "\r", t: "\t", '"': '"', "\\": "\\" } as const)[escaped];
          if (decoded === undefined) this.fail("GS1001", `Unsupported escape sequence \\${escaped}`, start);
          value += decoded;
        } else {
          value += this.advance();
        }
      }
      if (this.atEnd()) this.fail("GS1001", "Unterminated string literal", start);
      this.advance();
      return this.token("string", value, start);
    }

    const compound = symbolCandidates.find((candidate) =>
      this.source.startsWith(candidate, this.offset));
    if (compound !== undefined) {
      this.advanceMany(compound.length);
      return this.token("symbol", compound, start);
    }

    if (singleSymbols.has(current)) {
      this.advance();
      return this.token("symbol", current, start);
    }

    this.fail("GS1001", `Unexpected character ${JSON.stringify(current)}`, start);
  }

  private skipTrivia(): void {
    while (!this.atEnd()) {
      if (/\s/.test(this.peek())) {
        this.advance();
        continue;
      }
      if (this.source.startsWith("//", this.offset)) {
        while (!this.atEnd() && this.peek() !== "\n") this.advance();
        continue;
      }
      break;
    }
  }

  private token(kind: TokenKind, value: string, start: SourcePosition): Token {
    return { kind, value, range: { start, end: this.position() } };
  }

  private position(): SourcePosition {
    return { offset: this.offset, line: this.line, column: this.column };
  }

  private peek(ahead = 0): string {
    return this.source[this.offset + ahead] ?? "";
  }

  private atEnd(): boolean {
    return this.offset >= this.source.length;
  }

  private advance(): string {
    const character = this.source[this.offset] ?? "";
    this.offset += 1;
    if (character === "\n") {
      this.line += 1;
      this.column = 1;
    } else {
      this.column += 1;
    }
    return character;
  }

  private advanceMany(length: number): void {
    for (let index = 0; index < length; index += 1) this.advance();
  }

  private fail(code: string, message: string, start: SourcePosition): never {
    const diagnostic: Diagnostic = {
      code,
      severity: "error",
      message,
      sourcePath: this.sourcePath,
      range: { start, end: this.position() },
    };
    throw new GuardStepDiagnosticError([diagnostic]);
  }
}

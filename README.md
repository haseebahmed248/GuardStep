<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="logos/guardstep-logo-on-dark.svg">
    <img src="logos/guardstep-logo.svg" alt="GuardStep" width="560">
  </picture>
</p>

<p align="center"><strong>AI workflows, one guarded step at a time.</strong></p>

GuardStep is an experimental open-source language for AI workflows. A GuardStep file declares data contracts, model calls, tool access, enforceable budgets, approval points, and failure conditions in one place.

The repository now contains an executable alpha vertical slice: the CLI parses and checks the document-Q&A workflow, compiles it to versioned IR, generates TypeScript contracts, and runs it with either deterministic adapters or a real local Ollama model. The runtime enforces wall-clock deadlines and aborts in-flight adapters when the declared duration is exhausted. It is not ready for production use.

## Try it

```bash
npm install
npm run build
./gs check examples/document-qa/answer.guard
./gs compile examples/document-qa/answer.guard
./gs generate examples/document-qa/answer.guard
./gs run examples/document-qa/answer.guard
./gs test examples/document-qa/answer.guard
```

With Ollama installed and `qwen2.5:3b` pulled, the live local-model path is one command:

```bash
npm run demo:ollama
```

The short `gs` wrapper is for repository development. Installed packages expose both `guardstep` and `gs`. See the [CLI alpha documentation](packages/guardstep/README.md) and [model-provider setup](docs/PROVIDERS.md).

## The idea

An AI feature often has logic in several places: prompts, model SDK calls, validation schemas, tool handlers, retry code, authorization checks, and client streaming code. GuardStep tests whether those parts can be represented as one typed workflow without hiding their effects.

```guardstep
workflow AnswerQuestion(input: Question) -> Answer {
  allow tools [documents.search]
  limit cost <= 0.05 USD
  limit duration <= 20s

  context = call documents.search(query: input.text)
  answer = generate Answer using model("balanced") {
    "Answer using only the supplied context: {context}"
  }

  require answer.citations.length > 0
  return answer
}
```

The syntax above is illustrative, not a committed specification. The executable [standalone document Q&A workflow](examples/document-qa/answer.guard) is the current Stage 1 subset; the [embedded TypeScript draft](examples/document-qa/answer.workflow.ts) remains design evidence. See the [syntax options](docs/SYNTAX.md) for their shared semantics and tradeoffs.

## Name

**Guard** refers to a check or permission around an operation. **Step** is a unit of workflow execution. The name describes the intended execution model: checks are attached to the steps they govern.

Canonical naming:

- Project and language: **GuardStep**
- CLI and package namespace: `guardstep`
- Source file extension: `.guard`

## Planned properties

- Typed inputs, outputs, tools, and model responses
- Model- and provider-independent workflows
- Explicit permissions, budgets, retries, and approval gates
- Deterministic control flow around nondeterministic model calls
- Streaming, cancellation, tracing, evaluation, and replay as language-level concepts
- Standard interoperability through MCP, A2A, OpenAPI, JSON Schema, and OpenTelemetry
- Generated clients for TypeScript first, with web and mobile targets following
- A compiler and local runtime that do not require a hosted account

## Non-goals

- Replacing TypeScript, Python, Dart, Swift, or Kotlin
- Defining UI layout or styling
- Training a new foundation model
- Inventing proprietary replacements for open agent protocols
- Hiding arbitrary autonomy behind a single `agent` keyword

## Current work

GuardStep is now in **Stage 1: executable language slice**. The repository currently provides:

- a standalone `.guard` lexer, parser, semantic checker, and source-located diagnostics;
- deterministic compilation to versioned, JSON-serializable workflow IR;
- `check`, `compile`, `generate`, `run`, and `test` CLI commands;
- generated TypeScript contracts for domain values, workflows, tools, models, and hosts;
- an in-memory runtime enforcing capabilities, call limits, cost and duration budgets, assertions, and output schemas;
- runtime-owned wall-clock deadlines with cancellation signals for tool and model adapters;
- deterministic fixture adapters plus a real OpenAI-compatible adapter tested with local Ollama; and
- an executable document-Q&A workflow with an 11-scenario conformance suite.

Stage 0 is complete. Its [evidence report](docs/STAGE-0-REPORT.md) records the reproducible framework comparison and the decision to pursue a standalone language. The three reference applications remain the validation targets for later stages: [document Q&A](benchmarks/document-qa/README.md), [support approval](benchmarks/support-approval/README.md), and [mobile streaming](benchmarks/mobile-streaming/README.md).

See the [vision](docs/VISION.md), [architecture](docs/ARCHITECTURE.md), [syntax](docs/SYNTAX.md), [execution event model](docs/EXECUTION-EVENTS.md), and [roadmap](docs/ROADMAP.md).

## Open source

The project is licensed under [Apache License 2.0](LICENSE). Design proposals and major decisions will be discussed publicly. See [CONTRIBUTING.md](CONTRIBUTING.md) and [GOVERNANCE.md](GOVERNANCE.md).

## Contributing today

Useful contributions at this stage include concrete workflows, compiler and runtime tests, adapter implementations, counterexamples, and documentation feedback. Major language changes should begin with an RFC so syntax and runtime semantics evolve together.

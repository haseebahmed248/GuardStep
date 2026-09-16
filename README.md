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

## How it works

GuardStep keeps tool permissions, budgets, and failure handling alongside the steps of an AI workflow. In the document-Q&A example, the workflow searches documents, passes them to a model, and checks the answer's output schema and citation assertions.

The following is an unchanged excerpt from the beginning of [the document-Q&A workflow](examples/document-qa/answer.guard), **not a complete standalone program**. The full file includes the record, enum, and tool declarations, followed by the rest of the workflow.

```guardstep
workflow AnswerQuestion(input: Question) -> Answer fails FailureCode {
  capabilities {
    documents.search else CAPABILITY_DENIED
  }

  limits {
    tool_calls <= 1
    model_calls <= 1
    duration <= 20s else DURATION_LIMIT_EXCEEDED
    cost <= 0.05 USD else COST_LIMIT_EXCEEDED
  }

  documents = call documents.search(question: input.question)
    on timeout => fail SEARCH_TIMEOUT
    on error => fail TOOL_CALL_FAILED
    on invalid => fail TOOL_OUTPUT_INVALID
```

Use the repository setup commands above with the full example, not the excerpt. Running it also uses the neighboring [input](examples/document-qa/answer.input.json) and [host](examples/document-qa/answer.host.mjs) files. The default host and [test fixtures](examples/document-qa/answer.test.mjs) are deterministic and need no API key or Ollama.

This remains experimental alpha software, not a production-ready system. Earlier syntax alternatives and their tradeoffs are kept in the [syntax design notes](docs/SYNTAX.md).

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
- a diagnostics-only `lsp --stdio` command for unsaved `.guard` buffers ([editor setup](docs/EDITOR.md));
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

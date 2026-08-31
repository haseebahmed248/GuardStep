<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="logos/guardstep-logo-on-dark.svg">
    <img src="logos/guardstep-logo.svg" alt="GuardStep" width="560">
  </picture>
</p>

<p align="center"><strong>AI workflows, one guarded step at a time.</strong></p>

GuardStep is a proposed open-source language for AI workflows. A GuardStep file is intended to declare data contracts, model calls, tool access, budgets, approval points, and failure conditions in one place.

There is no compiler or runtime yet. The repository contains research, design notes, and draft syntax.

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

The syntax above is illustrative, not a committed specification. Stage 0 now compares a complete [standalone document Q&A draft](examples/document-qa/answer.guard) with an [embedded TypeScript draft](examples/document-qa/answer.workflow.ts); see the [syntax options](docs/SYNTAX.md) for their shared semantics and tradeoffs.

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

The immediate goal is to validate the language with three real applications before freezing syntax:

1. A [document question-answering benchmark](benchmarks/document-qa/README.md)
2. A [support workflow with tools and human approval](benchmarks/support-approval/README.md)
3. A mobile application consuming a streaming AI workflow

See the [vision](docs/VISION.md), [landscape research](docs/research/LANDSCAPE.md), [architecture proposal](docs/ARCHITECTURE.md), [syntax options](docs/SYNTAX.md), [execution event model](docs/EXECUTION-EVENTS.md), and [roadmap](docs/ROADMAP.md).

## Open source

The project is licensed under [Apache License 2.0](LICENSE). Design proposals and major decisions will be discussed publicly. See [CONTRIBUTING.md](CONTRIBUTING.md) and [GOVERNANCE.md](GOVERNANCE.md).

## Contributing today

Useful contributions at this stage are concrete use cases, counterexamples, syntax experiments, and criticism of the proposed semantics. Large compiler changes should wait for an accepted RFC.

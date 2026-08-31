<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="logos/guardstep-logo-on-dark.svg">
    <img src="logos/guardstep-logo.svg" alt="GuardStep" width="560">
  </picture>
</p>

<p align="center"><strong>AI workflows, one guarded step at a time.</strong></p>

GuardStep is an experimental open-source language for AI workflows. A GuardStep file declares data contracts, model calls, tool access, budgets, approval points, and failure conditions in one place.

The repository now contains an executable alpha vertical slice: the CLI parses and checks the document-Q&A workflow, compiles it to versioned IR, runs it with deployment-owned adapters, and passes the 11-scenario conformance suite. It is not ready for production use.

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

The short `gs` wrapper is for repository development. Installed packages expose both `guardstep` and `gs`. See the [CLI alpha documentation](packages/guardstep/README.md).

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

Stage 0 defined three reference applications before freezing syntax:

1. A [document question-answering benchmark](benchmarks/document-qa/README.md)
2. A [support workflow with tools and human approval](benchmarks/support-approval/README.md)
3. A [mobile application consuming a streaming AI workflow](benchmarks/mobile-streaming/README.md)

See the [vision](docs/VISION.md), [landscape research](docs/research/LANDSCAPE.md), [architecture proposal](docs/ARCHITECTURE.md), [syntax options](docs/SYNTAX.md), [execution event model](docs/EXECUTION-EVENTS.md), and [roadmap](docs/ROADMAP.md).

The [Stage 0 evidence report](docs/STAGE-0-REPORT.md) records the reproducible framework comparison and the decision to test a standalone `.guard` compiler in Stage 1. The current implementation is that first executable test.

## Open source

The project is licensed under [Apache License 2.0](LICENSE). Design proposals and major decisions will be discussed publicly. See [CONTRIBUTING.md](CONTRIBUTING.md) and [GOVERNANCE.md](GOVERNANCE.md).

## Contributing today

Useful contributions at this stage are concrete use cases, counterexamples, syntax experiments, and criticism of the proposed semantics. Large compiler changes should wait for an accepted RFC.

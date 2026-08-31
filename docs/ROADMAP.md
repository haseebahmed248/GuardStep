# GuardStep roadmap

Dates are intentionally omitted until the validation work measures the scope.

## Stage 0: prove the need

- Write three reference application requirements independent of any framework. The first two are the [document Q&A benchmark](../benchmarks/document-qa/README.md) and the [support approval benchmark](../benchmarks/support-approval/README.md).
- Implement document Q&A in plain TypeScript, BAML, and either LangGraph or Pydantic AI.
- Draft and compare [at least two competing syntax styles](SYNTAX.md).
- Specify the [minimum execution event model](EXECUTION-EVENTS.md).
- Decide whether a standalone language beats an embedded TypeScript API.

Exit criterion: a published comparison records the source, test setup, failures, and results. Continue only if GuardStep shows a useful advantage.

## Stage 1: executable language slice

- Parser, source locations, formatter, and basic language server
- Records, enums, lists, optionals, and function/workflow signatures
- Model and tool calls with typed inputs and outputs
- Branching and final results
- In-memory local runtime
- Mock provider and deterministic fixtures
- `check`, `run`, and `test` CLI commands
- TypeScript contract generation

Exit criterion: the document-Q&A example runs locally and has useful editor diagnostics.

## Stage 2: application workflow features

- Streaming event contracts and resumable client API
- Timeouts, retries, fallback, cancellation, and budgets
- Capability manifests and runtime grants
- Human approval and suspension
- MCP tools
- OpenTelemetry traces
- OpenAPI and JSON Schema emission
- React example and generated client

Exit criterion: the support-approval web example survives expected failures and exposes a complete trace.

## Stage 3: portable product integration

- Persistent local execution and replay
- Python tool bridge
- Dart client generation and Flutter example
- Provider compatibility suite
- Dataset evaluations in CI
- First durable execution adapter

Exit criterion: web and mobile clients consume the same workflow contract, and an interrupted execution resumes safely.

## Stage 4: public preview

- Versioned language and IR specifications
- Compatibility and deprecation policy
- Package publishing and signed releases
- Documentation site and interactive playground
- Extension authoring guide
- Security review
- Public RFC process exercised by external contributors

Exit criterion: an external developer can build and deploy a small application without maintainer assistance.

## Explicitly later

- Visual workflow editor
- A2A agent interoperability
- Workflow optimizer
- Additional client generators
- WebAssembly runtime
- Self-hosted control plane

# Plain TypeScript baseline

This package implements the [document Q&A benchmark](../../README.md) without an AI workflow framework. It is the control implementation for later BAML, LangGraph, and GuardStep comparisons.

The implementation uses fixture-backed search and model adapters. It makes no network requests and requires no credentials.

## Requirements

- Node.js 22 or newer
- npm

## Run

From this directory:

```bash
npm ci
npm test
npm run benchmark
```

`npm test` validates the shared fixtures, compiles the project, and runs every conformance scenario with Node's test runner. `npm run benchmark` prints one result per scenario and exits non-zero when any result or event sequence differs from the benchmark contract.

## Structure

- `src/workflow.ts` contains the workflow and policy enforcement.
- `src/adapters.ts` contains deterministic search and model adapters.
- `src/contracts.ts` validates public values against the shared JSON Schemas.
- `src/prompt.ts` defines the provider-neutral model request instructions.
- `src/events.ts` records the portable event sequence.
- `src/conformance.ts` runs scenarios and compares actual behavior with expected behavior.
- `test/conformance.test.ts` exposes each scenario as an independent test.

This package deliberately does not hide orchestration behind reusable framework helpers. The amount of application-owned validation, policy, tracing, and test code is part of what the benchmark measures.

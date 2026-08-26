# BAML with TypeScript orchestration

This package implements the [document Q&A benchmark](../../README.md) with BAML defining the model-facing types and `AnswerQuestion` prompt, and TypeScript orchestrating capabilities, effects, budgets, portable events, and postconditions.

The conformance suite uses fixture-backed search and model adapters. It makes no network requests and requires no credentials. A separate contract test asks BAML to render the provider request locally so the generated output schema and grounding instructions are exercised without sending it.

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

`npm test` validates the shared fixtures, regenerates the BAML client, compiles the project, and runs all conformance and BAML contract tests. `npm run benchmark` prints one result per scenario and exits non-zero on a contract difference.

## Structure

- `baml_src/document_qa.baml` owns the model-facing `Document`, `Citation`, and `Answer` types and the grounded prompt.
- `src/workflow.ts` contains host-side orchestration and policy enforcement.
- `src/adapters.ts` contains deterministic search and BAML model adapters.
- `src/contracts.ts` validates public values against the shared JSON Schemas.
- `src/events.ts` records the portable event sequence.
- `src/conformance.ts` checks every scenario against the shared benchmark contract.

Generated `baml_client` files and the lockfile are excluded from comparison source-line counts. Public JSON Schema validation remains host-owned because BAML's generated TypeScript type cannot validate deliberately malformed fixture output at runtime.

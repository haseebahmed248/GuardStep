# LangGraph with TypeScript

This package implements the [document Q&A benchmark](../../README.md) as a compiled LangGraph `StateGraph`. Four typed nodes handle run initialization, capability enforcement, document search, and answer generation. Conditional edges prevent later effects after a terminal capability, tool, assertion, or budget failure.

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

`npm test` validates the shared fixtures, compiles the project, checks the graph topology, and runs every conformance scenario with Node's test runner. `npm run benchmark` prints one result per scenario and exits non-zero on a contract difference.

## Structure

- `src/workflow.ts` defines the state schema, graph nodes, edges, routing, and host policy enforcement.
- `src/adapters.ts` contains deterministic search and model adapters.
- `src/contracts.ts` validates public values against the shared JSON Schemas.
- `src/events.ts` creates immutable portable event updates.
- `src/prompt.ts` defines the provider-neutral structured model request.
- `src/conformance.ts` checks every scenario against the shared benchmark contract.

LangGraph owns graph compilation, node execution, state propagation, and conditional routing. The application still owns public contract validation, stable failure codes, capabilities, effect budgets, citation postconditions, and portable event payloads; that boundary is part of the Stage 0 comparison.

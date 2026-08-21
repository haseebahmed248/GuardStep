# GuardStep vision

Status: design hypothesis. No claims in this document describe implemented behavior.

## Problem

Building an AI feature is not just sending a prompt to a model. A production feature also needs schemas, tool permissions, model selection, retries, timeouts, streaming, persistence, human approval, cost controls, tracing, and client contracts.

General-purpose languages can express all of this. In practice, the workflow is often split between application code, provider configuration, schemas, and infrastructure. Frameworks reduce that work, but their contracts usually remain tied to their host language and runtime.

## Thesis

A small domain-specific language may make an AI workflow:

- easier to understand than framework glue code;
- safer through static capability and type checks;
- portable across model providers and execution backends;
- directly consumable by web and mobile clients through generated contracts; and
- observable and testable because every nondeterministic boundary is explicit.

This is a hypothesis, not a finding. GuardStep is worth continuing only if reference implementations show a clear advantage over ordinary TypeScript or Python.

## Intended users

The initial user is a product engineer building AI-backed web, mobile, or API features. They understand APIs and types but should not need to become an orchestration-infrastructure specialist.

The initial language is not aimed at nontechnical visual builders or researchers writing custom GPU kernels.

## Intended use

Define an AI feature's contracts and effects in one source file, run it locally or through a supported backend, and generate matching client contracts for web, mobile, and server applications.

## Principles

### Contracts are public

Inputs, outputs, tools, side effects, and failure behavior are part of the public contract. Prompt text belongs to the implementation of that contract.

### Authority is declared

A workflow must declare a capability before using it. The host still decides whether to grant that capability. Sensitive tools may require approval at runtime. The proposed secret type is an opaque host-supplied handle rather than a normal string.

### Nondeterminism is visible

Model and external tool calls are marked effectful. Pure expressions remain replayable. The compiler should reject unsafe nondeterminism inside durable sections.

### The IR is a versioned boundary

The language defines stable semantics and a versioned intermediate representation. Model providers, durable runtimes, storage engines, and telemetry exporters remain adapters.

### Source is text

Source files are reviewable, mergeable, and formatter-owned. A future visual editor may project the same intermediate representation, but YAML or a proprietary canvas will not be the source of truth.

### Existing standards come first

MCP is the proposed tool adapter. A2A may later serve as an external-agent boundary. OpenAPI and JSON Schema describe generated application interfaces, and OpenTelemetry carries runtime telemetry. GuardStep should not invent a replacement for any of them.

## What must be tested together

Most items below already exist in other projects. The research question is whether combining them in one language creates a useful contract:

1. A real, statically checked workflow language
2. Capability-based tool security
3. Durable and streaming execution semantics
4. Portable, versioned workflow IR
5. Generated web and mobile contracts
6. Provider-neutral model profiles instead of model IDs scattered through source
7. Built-in simulation, evaluation, and replay

The comparison method is defined in [landscape research](research/LANDSCAPE.md). Syntax must remain provisional until that work is complete.

## Success criteria for the first public preview

- Three reference applications use the same workflow contracts from different clients.
- A new contributor can understand and modify an example in under 30 minutes.
- Invalid tool use and invalid model output fail with useful source-level diagnostics.
- A workflow can run against at least two model providers without source changes.
- Every model and tool call appears in a standards-compatible trace.
- The core compiler and local runtime work without a hosted account.

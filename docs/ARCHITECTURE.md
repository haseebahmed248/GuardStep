# GuardStep architecture proposal

Status: proposal. None of the components below has been implemented. The source pipeline shown here describes the standalone-language option; the [syntax comparison](SYNTAX.md) also evaluates an embedded TypeScript API that would change the frontend and tooling layers while targeting the same IR.

## System shape

```text
.guard source
    -> parser and linker
    -> semantic/type/capability checks
    -> versioned workflow IR
       -> local TypeScript runtime
       -> generated TypeScript client
       -> generated OpenAPI/JSON Schema
       -> future durable-runtime adapters
```

## Proposed repository structure

```text
packages/
  language/       Grammar, AST mapping, diagnostics, formatter
  compiler/       Type checking, capability checking, IR emission
  ir/             Versioned, serializable workflow representation
  runtime/        Local executor and event stream
  provider-api/   Model and embedding provider interfaces
  tool-api/       Native and MCP tool interfaces
  codegen-ts/     TypeScript client and server contracts
  cli/            check, compile, run, test, inspect
  vscode/         Language client extension
examples/
  document-qa/
  support-approval/
  mobile-streaming/
```

Start as a package-based monorepo, but publish only when APIs become useful. Repository structure should follow accepted semantics, not precede them.

## Compiler stages

### 1. Parse and link

Parse source into a syntax-aware AST, resolve imports and symbol references, and retain source ranges for every node. Diagnostics must refer to the user's source rather than generated code.

Initial candidate: [Langium](https://langium.org/docs/features/) and TypeScript. Langium derives a parser and TypeScript AST types from a grammar and provides Language Server Protocol support. Its use is provisional; GuardStep's semantic checker and IR should not depend on Langium-specific AST shapes.

### 2. Semantic analysis

Check:

- input/output and expression types;
- structured model output schemas;
- tool argument/result types;
- declared versus used capabilities;
- return completeness;
- unreachable steps;
- parallel data conflicts;
- invalid retry or durability combinations; and
- secret values crossing unsafe boundaries.

### 3. Lower to workflow IR

The IR should be JSON-serializable, versioned, and independent of surface syntax. It is the contract between compiler, runtimes, generators, and visual tools.

Early IR node families:

- pure expression;
- model call;
- tool call;
- branch;
- parallel/join;
- approval/suspend;
- assertion;
- emit stream event; and
- return/fail.

Each effectful node has a stable source-derived ID, input/output schema, policy metadata, retry policy, and source map.

### 4. Validate and emit

The compiler emits an IR bundle plus JSON Schemas and metadata. Provider credentials and deployment-specific endpoints never appear in the bundle.

## Runtime semantics

### Execution states

`pending`, `running`, `waiting`, `succeeded`, `failed`, and `cancelled`.

### Effects

Model calls, tool calls, clocks, randomness, approvals, and external I/O are effects. A runtime records effect requests and results. Pure computation may be replayed; completed effects must not be silently repeated during durable replay.

### Streaming

The runtime produces a typed event stream separate from the final workflow result. The Stage 0 [minimum execution event model](EXECUTION-EVENTS.md) defines portable lifecycle events and redaction rules. Typed application streaming, persisted cursors, disconnects, and resume behavior remain later runtime work.

### Idempotency

Every effect receives an execution ID and stable step ID. Tool adapters must declare whether they support idempotency. Retrying a non-idempotent tool requires an explicit policy or approval.

### Budgets

Budgets may constrain model cost, tokens, tool calls, wall-clock duration, or workflow steps. Static analysis can prove only some limits; the runtime enforces the rest. Currency limits require deployment-supplied pricing data with a recorded source and effective date. Model prices must not be compiled into the language specification.

## Target security model

- Workflows declare required capabilities.
- Hosts grant a subset of capabilities at deployment or invocation.
- Tools are denied unless declared and granted.
- Tools can declare risk levels and approval requirements.
- Secrets are opaque host-provided references.
- Model calls receive only values explicitly placed in their context.
- Compiler output includes a capability manifest suitable for review.
- MCP authorization and consent remain host responsibilities; language declarations provide an additional policy layer.

These rules limit authority; they do not establish that model output or tool content is trustworthy. Prompt injection, malicious tools, and compromised hosts remain possible.

## Provider abstraction proposal

Source code should normally select a semantic profile such as `fast`, `balanced`, `reasoning`, or a project-defined profile. Deployment configuration maps profiles to concrete provider models and parameters.

Provider-specific features remain accessible through explicitly namespaced extensions. The compiler warns when a workflow loses portability.

## Interoperability priorities

1. [JSON Schema 2020-12](https://json-schema.org/specification) for public data contracts
2. TypeScript types and streaming client
3. [OpenAPI](https://spec.openapis.org/oas/latest.html) endpoint descriptions
4. [MCP](https://modelcontextprotocol.io/specification/) tool adapter
5. [OpenTelemetry](https://opentelemetry.io/docs/specs/semconv/) trace export
6. Python server/tool bridge
7. Dart client generation
8. Durable runtime adapter
9. A2A external-agent adapter

## Proposed testing model

- Pure workflow logic uses normal deterministic unit tests.
- Model calls can be replaced by typed fixtures.
- Recorded effect logs support replay tests.
- Assertions can evaluate schema, invariants, latency, and cost without pretending subjective quality is a type error.
- Dataset evaluation belongs in the CLI and CI integration, not in compilation.

## Naming conventions

- Project and language: **GuardStep**
- Executable and CLI commands: `guardstep`
- Source files: `*.guard`
- Code-fence identifier: `guardstep`

## Deferred decisions

- Exact surface syntax
- Package manager and monorepo tool
- Whether the local persistence implementation uses SQLite
- First production durability backend
- Plugin ABI and third-party provider packaging

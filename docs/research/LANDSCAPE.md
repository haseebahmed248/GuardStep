# Landscape research

Last checked: 2026-08-21.

## Method

This review uses official documentation, specifications, and project repositories. Product capabilities change, so each comparison links to its source. The table describes documented behavior; it does not rank project quality or claim that GuardStep is unique.

## Adjacent projects

| Project | Documented focus | Relevant capability | Question for GuardStep |
| --- | --- | --- | --- |
| [BAML](https://docs.boundaryml.com/home) | DSL for structured LLM output | Typed functions, structured streaming, provider configuration, and [generated clients](https://docs.boundaryml.com/guide/introduction/baml_client) | Does a separate workflow language add enough value beyond BAML plus host-language orchestration? |
| [LMQL](https://lmql.ai/docs/latest/language/reference.html) | Python-based language for LLM programs | Query strings, control flow, decoding strategies, and [output constraints](https://lmql.ai/docs/latest/language/constraints.html) | Should GuardStep leave token-level generation control to specialized systems? |
| [LangGraph](https://docs.langchain.com/oss/python/langgraph/overview) | Low-level orchestration runtime | Stateful graphs, persistence, streaming, durable execution, and human interruption | Can a standalone source format and portable IR justify another layer above a host-language runtime? |
| [Pydantic AI](https://pydantic.dev/docs/ai/) | Python agent framework | Typed outputs, model and tool interfaces, MCP, streaming, and [durable-runtime integrations](https://pydantic.dev/docs/ai/capabilities/durable_execution/overview/) | Are polyglot contracts worth giving up Python as the source of truth? |
| [DSPy](https://dspy.ai/) | Python framework for AI programs | Typed signatures, composable modules, evaluation, and optimizers that tune prompts against metrics | Should optimization remain outside the GuardStep language core? |
| [Temporal](https://docs.temporal.io/workflows) | Durable workflow execution | Event-history replay and deterministic workflow requirements | Which GuardStep semantics can map to Temporal without copying Temporal into the local runtime? |
| [Dify](https://github.com/langgenius/dify) | Visual platform for LLM applications | Visual workflows, model and tool integrations, RAG, APIs, and [YAML DSL import/export](https://docs.dify.ai/en/cloud/use-dify/workspace/app-management) | Does a text-first, compiler-checked workflow provide a clear benefit over a platform-owned canvas and export format? |

## Protocols and data formats

### Model Context Protocol

[MCP](https://modelcontextprotocol.io/specification/) defines a client-server protocol for tools, resources, and prompts. The current release at the time of this review is [2026-07-28](https://blog.modelcontextprotocol.io/posts/2026-07-28/). MCP also defines HTTP authorization behavior; it does not grant a GuardStep workflow permission to use a tool.

Decision to test: implement MCP as one tool adapter. GuardStep capability declarations remain an additional compiler and host policy layer.

### Agent2Agent Protocol

[A2A 1.0](https://a2a-protocol.org/latest/specification/) defines discovery and communication between independent agent systems. It is complementary to MCP rather than a tool protocol.

Decision: defer A2A until one GuardStep workflow can run reliably. Multi-agent syntax is outside the first prototype.

### JSON Schema and OpenAPI

[JSON Schema 2020-12](https://json-schema.org/specification) is the current JSON Schema version. [OpenAPI 3.2.0](https://spec.openapis.org/oas/latest.html) is the current OpenAPI release. These formats cover data validation and HTTP interface description; they do not define GuardStep execution semantics.

Decision to test: emit JSON Schema for public records and OpenAPI for exposed workflow endpoints. Add conformance tests against independent validators.

### OpenTelemetry

[OpenTelemetry semantic conventions](https://opentelemetry.io/docs/specs/semconv/) define common names and attributes for telemetry. Generative-AI conventions are still changing and have moved to a separate specification repository.

Decision to test: keep the GuardStep event log versioned and map it to OpenTelemetry on export. Do not make replay depend on an unstable telemetry convention.

## Language tooling

[Langium](https://langium.org/docs/features/) generates a parser and TypeScript AST types from a grammar and provides Language Server Protocol support. It fits the proposed TypeScript prototype, but its inferred AST should not become the GuardStep specification.

Decision to test: use Langium for the first parser and editor diagnostics. Keep semantic analysis and the workflow IR behind a separate internal interface.

## Initial implementation language

TypeScript is the first implementation candidate because Langium is written in TypeScript, the first generated client targets TypeScript, and the reference web application will use the same toolchain. GitHub's [2025 Octoverse report](https://github.blog/news-insights/octoverse/octoverse-a-new-developer-joins-github-every-second-as-ai-leads-typescript-to-1/) provides secondary ecosystem evidence: TypeScript ranked first by monthly contributors on GitHub in August 2025, while Python remained dominant in AI and data-science repositories. Popularity alone is not a technical justification.

Decision: build one compiler and local runtime in TypeScript. Add Python interoperability without splitting the compiler implementation across languages.

## Research target

GuardStep tests whether one statically checked source file can cover:

- typed application inputs and outputs;
- model calls and validated structured output;
- tools and declared capabilities;
- streaming and cancellation;
- budgets, timeouts, retries, and fallback;
- human approval and suspension;
- durable execution boundaries;
- evaluation assertions and replay fixtures; and
- generated client contracts for web and mobile.

Several projects above implement substantial parts of this list. No uniqueness claim should be made before equivalent reference applications are built and compared.

## Research questions

1. Which useful capability errors can the compiler catch before deployment?
2. What is the smallest execution model that supports both a local runtime and a durable backend?
3. Is streaming a return type, an effect, or a projection of runtime events?
4. Can provider-neutral profiles express intent without hiding important provider differences?
5. Can generated Dart contracts cover the mobile use case without a Dart runtime?
6. Which guarantees belong to the compiler, runtime, adapter, and host?
7. Is GuardStep clearer than an embedded TypeScript API for the three reference applications?

## Required validation

Before fixing the grammar, implement the document-Q&A workflow in:

1. plain TypeScript;
2. BAML plus TypeScript orchestration;
3. LangGraph or Pydantic AI; and
4. the GuardStep prototype.

Use the same functional requirements and failure cases. Record source lines, duplicated contracts, build and editor diagnostics, provider-switching work, runtime failures, and trace output. Publish the code and raw results. If GuardStep does not show a useful advantage, narrow or stop the language project.

# Stage 0 evidence report

Status: completed evidence review, 2026-08-31. This report does not claim that a GuardStep compiler or runtime exists.

## Decision

Proceed to the smallest executable GuardStep slice using a **standalone `.guard` language**, not an embedded TypeScript API.

This is a constrained decision, not a syntax freeze. Stage 0 shows that current libraries leave capabilities, budgets, stable failures, event redaction, and cross-effect postconditions in application code. A standalone source format has a credible structural advantage because it can make the effect graph closed and compile it to portable IR without evaluating arbitrary application code. Stage 1 must now prove that advantage with working diagnostics and conformance, or the project should reconsider its direction.

The architecture decision is recorded in [ADR 0001](decisions/0001-standalone-workflow-language.md).

## Work completed

Stage 0 produced:

- three framework-independent reference contracts: [document Q&A](../benchmarks/document-qa/README.md), [support approval](../benchmarks/support-approval/README.md), and [mobile streaming](../benchmarks/mobile-streaming/README.md);
- plain TypeScript, BAML, and LangGraph implementations of document Q&A;
- two source-syntax drafts for the same workflow;
- a canonical minimum execution-event v1 schema and lifecycle rules; and
- deterministic fixture validators for all three reference contracts.

GuardStep itself was not implemented. Therefore this report compares the existing implementations and uses the syntax work to choose the next experiment; it does not claim that GuardStep already beats them.

## Reproduction environment

The recorded run used:

| Item | Value |
| --- | --- |
| Repository base | `f37e60c` |
| Operating system | Darwin 25.2.0, arm64 |
| Node.js | 25.2.1 |
| npm | 11.6.2 |
| TypeScript | 7.0.2 in each implementation lockfile |
| BAML | 0.226.1 |
| LangGraph | 1.4.13 |

Each implementation declares Node.js 22 or newer. The recorded Node.js version satisfies that constraint but is not the minimum-version compatibility test.

Commands were run from their implementation directories:

```bash
npm test
npm run benchmark
```

The shared contract validators were also run directly:

```bash
node benchmarks/document-qa/validate-fixtures.mjs
node benchmarks/support-approval/validate-fixtures.mjs
node benchmarks/mobile-streaming/validate-fixtures.mjs
```

No test required credentials or network access. Fixture effects use simulated durations and do not sleep.

## Conformance results

| Implementation | Document Q&A scenarios | Additional contract test | Result |
| --- | ---: | --- | --- |
| Plain TypeScript | 11/11 | None | Pass |
| BAML + TypeScript orchestration | 11/11 | Rendered BAML prompt/output contract | Pass |
| LangGraph + TypeScript | 11/11 | Compiled graph topology | Pass |

All implementations produced the required public result or stable failure code and the exact portable event-type sequence for every scenario. The tested failures were:

- denied tool capability;
- search timeout;
- invalid structured model output;
- required, forbidden, and unknown citations;
- model-cost limit; and
- active-duration limit.

The support-approval validator passed 15 scenarios over two account fixtures. The mobile-streaming validator passed 19 client/API scenarios over five persisted runs. Those two contracts do not yet have framework implementations and are not included in the implementation line counts.

## Source measurement

Run:

```bash
node benchmarks/document-qa/measure-implementations.mjs
node benchmarks/document-qa/measure-implementations.mjs --files
```

The script counts non-blank, non-comment handwritten `.ts` and `.baml` lines below each implementation directory. It excludes generated BAML clients, `dist`, `node_modules`, lockfiles, configuration, package manifests, fixtures shared above the implementation directories, and documentation.

| Implementation | Counted files | Handwritten lines | Difference from plain TypeScript |
| --- | ---: | ---: | ---: |
| Plain TypeScript | 11 | 654 | baseline |
| BAML + TypeScript | 14 | 683 | +29 (+4.4%) |
| LangGraph + TypeScript | 12 | 778 | +124 (+19.0%) |

The totals include workflow logic, types, public schema adapters, fixture adapters, portable events, conformance runner, CLI, and tests. They measure this repository's implementations, not the intrinsic productivity of a framework.

The most revealing individual file is orchestration:

| Implementation | Primary workflow source |
| --- | ---: |
| Plain TypeScript `src/workflow.ts` | 188 lines |
| BAML `src/workflow.ts` | 188 lines |
| LangGraph `src/workflow.ts` | 297 lines |

BAML additionally uses 30 lines for the model contract/prompt and 9 lines for its model adapter. It improves the model-facing source of truth, but public JSON Schema validation and all cross-effect policy remain host-owned. LangGraph makes graph topology explicit, but its state, nodes, routes, and terminal guards add code for this linear workflow.

## Contract duplication

The public input and output schemas contain seven named fields: one input field, three answer fields, and three citation fields.

| Implementation | Public fields redeclared outside JSON Schema | Reason |
| --- | ---: | --- |
| Plain TypeScript | 7 | Handwritten TypeScript interfaces mirror the schemas |
| BAML + TypeScript | 7 | The question remains a host type; answer/citation fields are declared in BAML |
| LangGraph + TypeScript | 7 | Handwritten TypeScript interfaces mirror the schemas |

This count treats JSON Schema as the benchmark's public source of truth and counts a field once when another handwritten contract redeclares it. It does not count fixture shapes, internal runtime types, or generated BAML client fields.

None of the implementations generates its complete public host types from the benchmark schemas. BAML removes one model-contract duplication through generated client types, but a separate runtime JSON Schema validator is still required to reject deliberately malformed provider/fixture values.

## Comparison against the benchmark record

| Measure | Plain TypeScript | BAML + TypeScript | LangGraph + TypeScript |
| --- | --- | --- | --- |
| Runtime failures | All required codes pass | All required codes pass | All required codes pass |
| Trace completeness | Exact sequence in 11/11 | Exact sequence in 11/11 | Exact sequence in 11/11 |
| Test isolation | Offline, deterministic | Offline, deterministic | Offline, deterministic |
| Policy ownership | Application | Application | Application |
| Model contract | JSON Schema + TS | BAML + runtime JSON Schema | JSON Schema + TS/Zod ecosystem |
| Graph/runtime ownership | Application functions | Application functions; BAML owns model call contract | LangGraph owns graph execution |
| Direct production dependencies | 2 | 3 | 5 |
| Provider swap measurement | Not performed | Not performed | Not performed |
| Seeded compile-time failures | Not performed | Not performed | Not performed |
| Editor study | Not performed | Not performed | Not performed |

The last three rows are explicit limitations, not zero scores. No live provider adapter or five-person comprehension study was added, so this report makes no claim about provider-switch effort, editing speed, or subjective readability.

## What the implementations demonstrate

### Plain TypeScript

Plain TypeScript is the smallest complete implementation in this experiment. It has excellent ordinary tooling and no workflow dependency. However, the program must manually coordinate every capability check, effect count, duration checkpoint, cost calculation, assertion, failure precedence rule, and event. The language cannot prevent an untracked `fetch`, filesystem call, clock, or provider SDK from entering the workflow.

### BAML

BAML gives the model request a concise typed source and generates model-facing client types. That is useful. It does not attempt to own the surrounding workflow, so the 188-line host orchestration remains. For GuardStep's scope, BAML is complementary evidence that a model DSL alone does not solve effect authority, budgets, approval, delivery, or portable lifecycle events.

### LangGraph

LangGraph owns state propagation, graph compilation, node execution, and routing. That becomes valuable for genuinely branching or cyclic workflows. In this linear reference case, the application still implements the safety contract and uses additional routes to ensure terminal failures cannot reach later effects. The framework does not provide GuardStep's public failure or event contract automatically.

## Why standalone won the next experiment

The [syntax comparison](SYNTAX.md) identified two options. An embedded TypeScript API has lower initial tooling cost, but it cannot establish GuardStep's main proposed invariant by API design alone: every effect must be statically visible and lowerable to portable IR.

An embedded callback can import or call ambient authority. Preventing that requires a restricted TypeScript subset, a custom source transform, lint rules, module evaluation rules, and build-version compatibility. At that point GuardStep would own a language boundary indirectly while still inheriting TypeScript's ambient semantics.

A standalone workflow source can instead:

- reject undeclared effects by grammar and semantic analysis;
- extract the graph without running user module initialization;
- emit host-language-independent IR and capability manifests;
- generate TypeScript and later Dart contracts from one source; and
- make review of capabilities, budgets, approval, and public failures local to the workflow.

Those are the differentiators the project needs to test. Familiar syntax alone is not enough reason to choose the embedded option if it weakens them.

## Costs and risks of the decision

Choosing standalone means GuardStep must own a parser, source mapping, formatter, diagnostics, language-server support, module rules, compatibility policy, and escape-hatch design. A poor authoring experience would erase the architectural benefit. Application-specific pure logic may also be more awkward than ordinary TypeScript.

The decision therefore selects a narrow compiler experiment, not a broad new-language build.

## Stage 1 proof gates

The executable slice should continue only while it can meet all of these gates:

1. Compile the document Q&A source to versioned, serializable IR without executing user code.
2. Pass all 11 document Q&A scenarios and the canonical execution-event v1 validator.
3. Produce source-located diagnostics for an undeclared capability, invalid field, undeclared failure, missing return, unsupported unit, and effect in a pure expression.
4. Make an untracked network or filesystem effect impossible to express in the initial workflow subset.
5. Generate public TypeScript contracts from the workflow source rather than redeclaring its seven public fields.
6. Keep workflow-author source materially smaller than the 654-line plain TypeScript application while reporting compiler/runtime platform code separately.
7. Demonstrate that changing the configured model provider does not change workflow source.
8. Document every unsupported construct and fail closed rather than silently delegating it to JavaScript.

After document Q&A, the support-approval contract must test whether the IR can represent durable suspension without repeating effects. Mobile streaming then tests generated-client and delivery semantics. If the standalone design cannot preserve those semantics without large escape hatches, reconsider an embedded library or a narrower schema/compiler product.

## Limitations

- One workflow has framework implementations; the more demanding approval and mobile contracts currently have requirements and fixtures only.
- All effects are fixture-backed; no provider latency, SDK ergonomics, or deployment behavior was measured.
- Source lines do not measure correctness, readability, maintenance cost, or framework value in larger graphs.
- The implementations intentionally repeat support code to keep ownership visible; shared abstractions could reduce each total.
- No seeded compiler-diagnostic suite or product-engineer comprehension study was run.
- The test wall-clock observations were smoke checks on one machine, not performance benchmarks.

These limitations are why the standalone choice remains reversible and why Stage 1 has explicit proof gates.

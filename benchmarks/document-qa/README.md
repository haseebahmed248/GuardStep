# Document Q&A benchmark

Status: Stage 0 benchmark contract. This is not a GuardStep language specification.

This benchmark compares how different implementations express and enforce the same small AI workflow. The first implementations will use plain TypeScript, BAML with TypeScript orchestration, LangGraph, and the GuardStep prototype.

## Implementations

- [Plain TypeScript baseline](implementations/typescript/README.md)
- [BAML with TypeScript orchestration](implementations/baml/README.md)
- [LangGraph with TypeScript](implementations/langgraph/README.md)

The conformance suite is deterministic. It uses the documents and effect responses in [`fixtures`](fixtures/) instead of a live search service or model. Live-provider evaluation may be added later, but its results must be reported separately.

## Workflow

An implementation receives a question and performs these steps:

1. Confirm that the host granted the `documents.search` capability.
2. Call `documents.search` once with the unmodified question.
3. Check the call-count and duration budgets before continuing.
4. Ask the configured model for a structured `Answer` using only the returned documents.
5. Validate the model result against [`output.schema.json`](schemas/output.schema.json).
6. Enforce the status-specific citation rules and validate every citation against the documents returned by the search call.
7. Check the duration and model-cost budgets, then return the answer or a stable failure code.

The public input contract is [`input.schema.json`](schemas/input.schema.json). Implementations may use additional internal types, but they must not weaken either public contract.

## Required behavior

### Grounding and citations

- An `answered` result has at least one citation.
- Every citation identifies a document returned by the search call.
- The citation title and URL exactly match that document.
- An `insufficient_context` result has no citations.
- The model receives only the question and the documents returned for that run.

The structural JSON Schema intentionally permits an empty citation list. Citation presence is a workflow postcondition so the comparison can distinguish schema validation from orchestration policy.

### Model request

The model adapter receives the question and the complete retrieved document records in fixture order. The request must instruct the model to:

- use only the supplied documents;
- return `answered` when the documents support an answer;
- return `insufficient_context` when they do not;
- copy citation IDs, titles, and URLs from the supplied documents; and
- return a value matching the public output contract.

Frameworks may encode these instructions differently when they automatically inject schemas. The implementation must preserve the requirements above and must not add outside knowledge or documents.

This suite checks citation references, not whether free-form prose is semantically entailed by a source. Claim-level grounding evaluation belongs in the later live-provider suite.

### Capabilities

The workflow declares `documents.search`. The host must grant the same capability for a run. A missing grant fails before the tool is called.

### Budgets

Every implementation enforces the following limits:

| Limit | Value |
| --- | ---: |
| Tool calls | 1 |
| Model calls | 1 |
| Wall-clock duration | 20,000 ms |
| Model cost | USD 0.05 |

Fixture time is simulated by each effect's `elapsed_ms`; tests must not sleep. Fixture model cost is calculated as:

```text
(input_tokens × input_usd_per_million / 1,000,000)
+ (output_tokens × output_usd_per_million / 1,000,000)
```

The fixture price table is part of [`scenarios.json`](fixtures/scenarios.json). Implementations must not fetch current provider prices during conformance tests.

Call-count and elapsed-time limits are checked before starting an effect and again after it completes. Model cost is checked when the adapter returns usage. A completed effect is recorded before a resulting budget failure, and no later effect may start.

## Failure contract

A failed run returns one of these codes. The message and framework-native exception shape are not compared.

| Code | Required condition |
| --- | --- |
| `CAPABILITY_DENIED` | `documents.search` was not granted |
| `SEARCH_TIMEOUT` | The search fixture reports a timeout |
| `MODEL_OUTPUT_INVALID` | Model output fails the public output schema |
| `CITATION_REQUIRED` | An answered result contains no citations |
| `CITATION_FORBIDDEN` | An insufficient-context result contains a citation |
| `CITATION_UNKNOWN` | A citation does not exactly match a retrieved document |
| `COST_LIMIT_EXCEEDED` | Recorded model usage costs more than USD 0.05 |
| `DURATION_LIMIT_EXCEEDED` | Simulated elapsed time exceeds 20,000 ms |

If several checks could fail, the implementation reports the first failure reached in workflow order. It must not start a later effect after a terminal failure.

## Event contract

Every run emits a sequence conforming to the canonical [`execution-event.v1.schema.json`](../../schemas/execution-event.v1.schema.json). Sequence numbers begin at zero and increase by one. All events for a run share one `run_id`. The lifecycle semantics are defined in the [minimum execution event model](../../docs/EXECUTION-EVENTS.md).

Required event order:

```text
run.started
  capability.checked
  tool.started
  tool.succeeded | tool.failed
  model.started
  model.succeeded | model.failed
  [assertion.failed | budget.exceeded]
run.succeeded | run.failed
```

Only events reached by the run are emitted. For example, `capability-denied` emits `run.started`, `capability.checked`, and `run.failed`; it does not emit a tool event. Framework-specific trace data may be recorded in addition to this portable sequence.

Event payloads must not contain model credentials, host secrets, or document content. IDs, counts, elapsed time, usage, cost, and stable error codes are allowed.

## Scenarios

[`scenarios.json`](fixtures/scenarios.json) is the source of truth for inputs, granted capabilities, effect behavior, expected terminal result, and required portable events.

For a succeeded scenario, `model.output` is the exact expected public result. Mock adapters return the specified documents, model output, usage, and simulated elapsed time without modification.

Check the fixture set itself with:

```bash
node benchmarks/document-qa/validate-fixtures.mjs
```

The suite covers:

- a supported question using one source;
- a supported question using multiple sources;
- a question the corpus cannot answer;
- a denied tool capability;
- a search timeout;
- malformed structured model output;
- a missing citation;
- a citation attached to an insufficient-context result;
- a citation to a document that was not retrieved;
- a model response that exceeds the cost budget; and
- an execution that exceeds the duration budget.

## Conformance requirements

An implementation conforms when one command:

1. runs every scenario without network access;
2. loads the fixture corpus and scenarios, and validates public inputs, model outputs, and emitted events against the supplied schemas;
3. produces the expected output or failure code;
4. produces the exact `required_events` sequence;
5. performs no effect after a terminal failure; and
6. exits non-zero if any scenario fails.

Each implementation must document its test command and runtime version. Shared fixture-loading and result-reporting code is allowed, but workflow logic must remain visible in the implementation being measured.

## Comparison record

Record these results for each implementation:

| Measure | Method |
| --- | --- |
| Hand-written source lines | Non-blank, non-comment lines required for the workflow, contracts, adapters, and tests |
| Contract duplication | Number of public fields declared in more than one source of truth |
| Static failures | Which benchmark failures are caught before execution |
| Runtime failures | Whether every expected failure has the required stable code |
| Trace completeness | Whether every scenario emits the required portable events |
| Provider coupling | Files and lines changed to select a second compatible model adapter |
| Editor support | Navigation, completion, and source-located diagnostics available during implementation |
| Test isolation | Whether conformance tests run without credentials or network access |

Generated files and lockfiles are excluded from source-line and duplication counts. Record tool versions and the exact counting command with the results.

## Out of scope

- Retrieval ranking quality
- Model answer quality beyond structural and citation-reference checks
- Embedding generation or vector databases
- Streaming tokens
- Persistence and durable replay
- Human approval
- Production authentication
- Performance comparisons

Those concerns remain relevant to GuardStep, but including them here would prevent the first implementations from being directly comparable.

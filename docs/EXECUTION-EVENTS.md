# Minimum execution event model

Status: Stage 0 portable event contract. This defines the minimum observable execution semantics required by the current reference workflow; it is not a persistence, streaming-token, or telemetry specification.

The canonical machine-readable envelope and core payload constraints are in [`execution-event.v1.schema.json`](../schemas/execution-event.v1.schema.json).

The key words **MUST**, **MUST NOT**, **SHOULD**, and **MAY** describe requirements for a conforming producer or consumer.

## Purpose

The event model gives clients, tests, logs, and future runtime adapters one provider-neutral account of what a workflow did. It must answer four questions without exposing prompts or business data:

1. Did the run start and how did it terminate?
2. Which authority checks, tools, and models were reached?
3. Which assertion or budget ended a failed run?
4. In what deterministic order did those facts become observable?

The portable stream complements framework-native traces. It does not replace OpenTelemetry spans, provider logs, or application analytics.

## Envelope

Every event has this shape:

```json
{
  "schema_version": 1,
  "sequence": 3,
  "run_id": "document-qa/answered-single-source",
  "type": "tool.succeeded",
  "step_id": "tool:documents.search",
  "data": {
    "tool": "documents.search",
    "elapsed_ms": 40,
    "document_ids": ["document-formats"]
  }
}
```

| Field | Requirement | Meaning |
| --- | --- | --- |
| `schema_version` | Required; exactly `1` | Version of the portable event contract, not the workflow or application version |
| `sequence` | Required; non-negative integer | Dense, zero-based emission order within one run |
| `run_id` | Required; non-empty string | Opaque host-assigned identifier shared by every event in the run |
| `type` | Required; closed v1 event name | Portable lifecycle fact described below |
| `step_id` | Required for step events; forbidden for run events | Stable compiler-assigned identity of the source step or generated policy step |
| `data` | Required object | Type-specific core fields plus safe application summary fields |

`run_id` plus `sequence` uniquely identifies an event in the minimum model. A separate event UUID, timestamp, trace ID, parent ID, and cursor are intentionally absent.

### Step identity

A compiler MUST assign the same `step_id` to the start and terminal event for one effect. It SHOULD derive the ID from a named source step or stable source identity, and MUST preserve it while that step is unchanged within a workflow version.

Generated policy checks also receive IDs, for example `capability:documents.search`, `assertion:citations`, `budget:duration`, or `budget:cost`. Run-level events do not describe a source step and MUST NOT contain `step_id`.

V1 executes a given effect step at most once per run. Retries and repeated loop iterations need an attempt identity and are deferred rather than being ambiguously represented by this contract.

## Event types

Application-specific keys MAY be added inside `data`. Consumers MUST ignore unknown `data` keys they do not need. Producers MUST still follow the data-minimization rules below.

| Type | `step_id` | Required `data` | Meaning |
| --- | --- | --- | --- |
| `run.started` | Forbidden | `workflow` | Run accepted and execution began; always sequence `0` |
| `capability.checked` | Required | `capability`, `granted` | Host grant checked before the protected effect |
| `tool.started` | Required | `tool`, `call` | Declared external tool effect began |
| `tool.succeeded` | Required | `tool`, `elapsed_ms` | Tool effect returned successfully |
| `tool.failed` | Required | `tool`, `error_code`, `elapsed_ms` | Tool effect ended with a stable failure |
| `model.started` | Required | `profile`, `call` | Provider-neutral model effect began |
| `model.succeeded` | Required | `elapsed_ms` | Model returned structurally valid output |
| `model.failed` | Required | `error_code`, `elapsed_ms` | Model call or structured-output validation failed |
| `assertion.failed` | Required | `error_code` | Workflow postcondition failed |
| `budget.exceeded` | Required | `error_code`, `actual`, `maximum`, `unit` | A runtime-enforced limit was exceeded |
| `run.succeeded` | Forbidden | `elapsed_ms` | Valid output was produced and all reached policies passed |
| `run.failed` | Forbidden | `error_code` | Run ended with the first stable terminal failure |

`call` is a positive, one-based ordinal within its effect kind for the run. `elapsed_ms`, `actual`, `maximum`, token counts, and cost amounts are non-negative.

### Optional model accounting

A successful model event MAY include:

```json
{
  "usage": {
    "input_tokens": 240,
    "output_tokens": 60
  },
  "cost": {
    "currency": "USD",
    "amount": 0.00036
  }
}
```

If the runtime uses token usage or calculated cost to enforce a declared budget, the corresponding accounting data MUST appear in `model.succeeded`. A terminal `run.succeeded` SHOULD include aggregate cost when cost is known.

Pricing source and effective date belong to deployment/run metadata and future inspection APIs, not every event.

## Sequence and lifecycle invariants

JSON Schema validates individual events. A conforming event sequence MUST additionally satisfy all rules in this section.

1. All events have the same `run_id` and `schema_version`.
2. Sequence values are exactly `0, 1, …, n-1` with no duplicates or gaps.
3. `run.started` is the first event and occurs exactly once.
4. A completed run has exactly one terminal event, `run.succeeded` or `run.failed`, and it is last.
5. No effect, assertion, budget, or run event is emitted after a terminal run event.
6. A protected tool cannot start until its `capability.checked` event reports `granted: true`.
7. Every `tool.started` or `model.started` has exactly one matching succeeded or failed event with the same `step_id`.
8. A succeeded/failed effect event cannot appear without its corresponding started event.
9. `assertion.failed` and `budget.exceeded` are terminal in v1 and are immediately followed by `run.failed` with the same `error_code`.
10. `tool.failed` and `model.failed` are immediately followed by `run.failed` with the same `error_code` unless a future version explicitly defines recovery.
11. `run.succeeded` is emitted only after the public result validates and all reached assertions and budgets pass.
12. When multiple conditions could fail, the producer emits only the first failure reached by workflow order.

A stream that ends without a run terminal event is incomplete, not successful. This can happen when a process crashes or a transport disconnects. Persistence and resumption behavior are outside v1.

## Required ordering for the reference workflow

The document Q&A workflow exercises the minimum model in this order:

```text
run.started
  capability.checked
  tool.started
  tool.succeeded | tool.failed
  model.started
  model.succeeded | model.failed
  assertion.failed | budget.exceeded
run.succeeded | run.failed
```

Only reached events are emitted. A capability denial therefore produces:

```json
[
  {
    "schema_version": 1,
    "sequence": 0,
    "run_id": "document-qa/capability-denied",
    "type": "run.started",
    "data": { "workflow": "AnswerQuestion" }
  },
  {
    "schema_version": 1,
    "sequence": 1,
    "run_id": "document-qa/capability-denied",
    "type": "capability.checked",
    "step_id": "capability:documents.search",
    "data": {
      "capability": "documents.search",
      "granted": false
    }
  },
  {
    "schema_version": 1,
    "sequence": 2,
    "run_id": "document-qa/capability-denied",
    "type": "run.failed",
    "data": { "error_code": "CAPABILITY_DENIED" }
  }
]
```

No `tool.started` event may follow the denied check.

### Effect completion before policy failure

When a completed effect causes a duration or cost violation, its success event comes first because the effect did complete. The budget failure follows:

```text
model.started
model.succeeded
budget.exceeded
run.failed
```

This ordering preserves the evidence needed to explain the budget decision and prevents a completed external effect from disappearing from the trace.

## Error semantics

`error_code` is the stable workflow-facing failure code. It MUST NOT contain a provider exception message, stack trace, secret, request body, or document content.

The same error code appears on the event that identifies the cause and on `run.failed`:

- `tool.failed` → `run.failed`;
- `model.failed` → `run.failed`;
- `assertion.failed` → `run.failed`; or
- `budget.exceeded` → `run.failed`.

Capability denial is represented by `capability.checked` with `granted: false`, followed by `run.failed` with the workflow's mapped denial code.

Framework-native exceptions MAY be retained in protected diagnostics or telemetry, but they are not portable events.

## Data minimization and security

Portable events are safe summaries, not an execution transcript.

Producers MUST NOT include:

- prompts or model responses;
- document contents, tool request/response bodies, or uploaded files;
- credentials, authorization headers, tokens, cookies, or secret handles;
- stack traces or raw provider errors; or
- personal or business data merely because it is available to the workflow.

Safe summaries MAY include declared names, source-derived IDs, stable error codes, counts, elapsed time, token usage, calculated cost, and non-sensitive record identifiers when an application policy permits them.

The runtime SHOULD construct core event payloads itself. Tool and model adapters must not be allowed to inject arbitrary top-level envelope fields.

## Determinism and time

`sequence` defines observable order. V1 deliberately omits wall-clock timestamps because they are not needed for conformance, can make replay nondeterministic, and already belong in telemetry systems.

`elapsed_ms` is a measured or simulated duration attached to effect/run completion. Conformance fixtures use simulated values and MUST NOT sleep. A production runtime defines the clock used for budget enforcement in run metadata.

Replaying a recorded run SHOULD reproduce the same portable event types, step IDs, failure code, and application summary fields. Timing and accounting values may come from the recorded effect results rather than being recomputed.

## Versioning and extensions

- The v1 event type set is closed. A new portable lifecycle type requires a schema-version change.
- New optional keys inside an existing event's `data` MAY be added without changing `schema_version` when they do not alter existing semantics.
- Consumers MUST ignore unknown `data` keys but MUST reject unsupported `schema_version` values.
- A required field removal, field reinterpretation, ordering change, or lifecycle-type addition requires a new version.
- Application-specific data keys MUST NOT redefine the meaning of core keys.

Workflow versioning is separate. Two workflow versions may both emit schema version `1` while using different source step IDs.

## Relationship to source syntax and IR

Surface syntax does not manually emit the lifecycle events above. The compiler lowers effects, assertions, budgets, and terminal paths into IR nodes with stable step IDs; the runtime derives portable events from those nodes.

Both current syntax options must produce the same event sequence for the same IR:

- standalone `.guard` source gives the compiler a closed set of effects; and
- embedded TypeScript must prevent untracked effects or it cannot claim complete traces.

This is a semantic requirement, not a formatting preference.

## Conformance

The [document Q&A benchmark](../benchmarks/document-qa/README.md) is the v1 conformance fixture. Its plain TypeScript, BAML, and LangGraph implementations all validate emitted events against the canonical schema and verify dense sequence numbers, shared run IDs, exact expected types, early termination, and content redaction.

An implementation conforms to the minimum model when:

1. every individual event validates against the v1 schema;
2. every completed run satisfies the lifecycle invariants;
3. every benchmark scenario emits the required exact event sequence; and
4. no event exposes fixture document content.

## Explicitly deferred

- cancellation and `run.cancelled`;
- retries, attempts, loops, parallel branches, and subworkflow causality;
- approval, suspension, and resume events;
- token or typed application streaming;
- persisted cursors and delivery guarantees;
- event timestamps and trace/span correlation;
- provider-specific request metadata;
- log levels and arbitrary user logs; and
- OpenTelemetry semantic-convention mapping.

These belong to later stages and must extend, rather than weaken, the v1 ordering and data-minimization guarantees.

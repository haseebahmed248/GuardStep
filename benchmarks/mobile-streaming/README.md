# Mobile streaming benchmark

Status: Stage 0 benchmark contract. This is not a GuardStep language or transport specification.

This benchmark compares how implementations expose one streaming AI workflow to a mobile client. The example application turns a field report into a briefing while streaming summary text, findings, and suggested actions. It tests the semantics that become important when a phone changes networks, backgrounds the application, retries a request, receives duplicate deliveries, or explicitly cancels work.

The fixtures are deterministic. They use recorded source events and persisted delivery logs instead of a live model or network connection.

## Workflow

`CreateFieldBriefing` receives a report and performs these steps:

1. Accept an idempotent start request containing `request_id`, `report_id`, `site_id`, and `report_text`.
2. Start one configured model call.
3. Validate each structured model event before persisting or delivering it.
4. Append typed summary deltas, findings, and actions to the run's durable stream in order.
5. Validate the final `FieldBriefing` result.
6. Require the final summary, findings, and actions to exactly match the projection of accepted stream events.
7. Append one terminal success or failure event.

The workflow does not invoke tools. This benchmark isolates public streaming, delivery, cancellation, and generated-client semantics from tool authorization and human approval, which the other reference benchmarks cover.

## Public contracts

- [`input.schema.json`](schemas/input.schema.json): idempotent workflow start input
- [`start.schema.json`](schemas/start.schema.json): accepted start response
- [`stream-event.schema.json`](schemas/stream-event.schema.json): versioned mobile delivery envelope
- [`reconnect.schema.json`](schemas/reconnect.schema.json): exclusive resume cursor request
- [`cancel.schema.json`](schemas/cancel.schema.json): explicit idempotent cancellation command
- [`output.schema.json`](schemas/output.schema.json): authoritative completed briefing

The start response returns `first_cursor: null`. The client consumes from the beginning until it has persisted a real cursor.

## Public delivery stream

The mobile delivery stream is deliberately separate from GuardStep's internal [execution event model](../../docs/EXECUTION-EVENTS.md). Internal events explain effects and policy decisions without exposing business payloads. The public stream carries application data that a generated client is allowed to render.

Every public event contains:

```json
{
  "protocol_version": 1,
  "run_id": "run-field-success",
  "sequence": 3,
  "cursor": "opaque-server-cursor",
  "type": "briefing.finding",
  "data": {
    "finding_id": "finding-1",
    "severity": "high",
    "text": "Drive motor reported above its safe limit."
  }
}
```

Version 1 has these closed event types:

| Type | Data |
| --- | --- |
| `run.started` | Workflow and report identifiers |
| `briefing.summary_delta` | Non-empty text fragment |
| `briefing.finding` | Typed finding |
| `briefing.action` | Typed suggested action |
| `run.succeeded` | Complete public result |
| `run.failed` | Stable error code |
| `run.cancelled` | Stable cancellation reason |

The runtime validates an application event before assigning a cursor. Invalid source data is never committed or delivered.

## Ordering and delivery

The persisted run log is the source of truth:

- sequence numbers are dense, zero-based, and immutable;
- cursors are opaque, unique within the run, and stable across delivery attempts;
- `run.started` is first;
- exactly one terminal event is last;
- nothing is appended after a terminal event; and
- the terminal success event contains the authoritative typed result.

Transport delivery is at least once. SSE, WebSocket, chunked HTTP, and native transports may implement the contract, but they must not change its meaning. A client therefore:

1. keys state by `run_id`;
2. persists the last contiguously applied cursor;
3. applies each sequence at most once;
4. ignores an exact duplicate;
5. does not apply an event beyond a sequence gap; and
6. reconnects using the last contiguous cursor.

Reconnect uses `after_cursor` exclusively, although a transport race may redeliver the boundary event. The client still deduplicates it. A successful reconnect reads the stored log and never repeats model work.

Slow consumers may pause transport reads. Implementations must use a bounded transport buffer backed by the persisted log; they must not drop application events or keep an unbounded in-memory queue.

## Projection and final result

Summary deltas concatenate in sequence order. Findings and actions append in sequence order and have unique IDs. Before success, the runtime requires those projections to exactly match the final result.

The final result is authoritative for completed UI state. Streamed content is progressive and may be discarded if the run fails or is cancelled. A client must not present a partial stream as a completed briefing.

## Start idempotency

`request_id` identifies one start attempt for one authenticated owner:

- the first valid request creates one run;
- retrying the same ID with byte-equivalent public input returns the existing run;
- retrying it with changed input returns `REQUEST_ID_CONFLICT`; and
- protocol negotiation happens before a run or model call is created.

Idempotency prevents a mobile HTTP retry from starting duplicate model work.

## Reconnect and ownership

The server authenticates the caller and checks run ownership before checking cursor validity or revealing run state. A caller who does not own a run receives `RUN_NOT_FOUND`, the same response as an unknown run.

For an owned run:

- `after_cursor: null` starts from the first event;
- a known cursor returns later persisted events;
- an unknown or expired cursor returns `CURSOR_INVALID`; and
- reconnecting does not change run state.

Fixtures assume a 24-hour retained log. Production retention may differ, but it must be declared to generated clients and cannot silently turn a gap into success.

## Cancellation

Closing a connection, losing connectivity, or backgrounding the application does not cancel a run. Cancellation requires the explicit [`cancel.schema.json`](schemas/cancel.schema.json) command.

Cancellation requests have their own `request_id`:

- the first accepted request ends an active run with one `run.cancelled` event;
- replaying the same request returns the stored cancelled state without another terminal event;
- no application event may be appended after cancellation; and
- cancellation after any terminal event returns `RUN_ALREADY_TERMINAL`.

Cancellation of an in-flight provider call is best effort, but the public terminal state is deterministic. Provider output arriving after accepted cancellation is discarded.

The internal execution-event v1 does not contain cancellation lifecycle types. This benchmark does not modify that schema; a later version must define how an in-flight model effect closes and how `run.cancelled` relates to internal trace ordering.

## Versioning

`protocol_version` versions the mobile delivery envelope, event names, ordering rules, and payload semantics. Version 1 is closed. A client requests its supported version when starting or reconnecting.

An unsupported version fails before execution with `UNSUPPORTED_STREAM_VERSION`. New optional fields that old clients may safely ignore can remain within a version; new event types, required fields, or changed ordering semantics require a new version.

Workflow versions, public result schemas, and internal execution-event schemas are separate concerns. Implementations must record their negotiated versions with the run.

## Failure contract

| Code | Boundary | Required condition |
| --- | --- | --- |
| `REQUEST_ID_CONFLICT` | Start API | Existing request ID is retried with changed input |
| `UNSUPPORTED_STREAM_VERSION` | Start/reconnect API | Client requests an unsupported protocol version |
| `RUN_NOT_FOUND` | Run API | Run is absent or not owned by the caller |
| `CURSOR_INVALID` | Reconnect API | Owned run does not contain the supplied retained cursor |
| `RUN_ALREADY_TERMINAL` | Cancel API | Cancellation arrives after success, failure, or cancellation |
| `STREAM_EVENT_INVALID` | Workflow | Model/source event fails its typed event contract |
| `STREAM_PROJECTION_MISMATCH` | Workflow | Final result differs from accepted application events |
| `MODEL_FAILED` | Workflow | Model terminates without a valid final result |

API rejections do not create workflow events. Workflow failures append `run.failed` as the only terminal event. Provider exceptions and stack traces are not public error codes.

## Security and data minimization

- Public events contain only fields declared by the stream schema.
- The original `report_text`, prompts, credentials, provider errors, and hidden reasoning never enter the delivery log.
- `site_id` is accepted by the workflow but is not automatically public.
- Authentication and ownership are host responsibilities and are checked on every start, reconnect, and cancel request.
- Streamed model content is untrusted display data, not authority to call a tool or mutate host state.

## Scenarios

[`runs.json`](fixtures/runs.json) contains five deterministic persisted logs. [`scenarios.json`](fixtures/scenarios.json) contains 19 client and API interactions.

Validate them with:

```bash
node benchmarks/mobile-streaming/validate-fixtures.mjs
```

The suite covers:

- uninterrupted completion;
- reconnecting after a stored cursor;
- duplicate normal and reconnect-boundary delivery;
- a sequence gap before application;
- disconnect without cancellation;
- new, retried, conflicting, and unsupported-version starts;
- active, replayed, and late cancellation;
- invalid cursor and non-owner reconnects;
- invalid structured source events;
- final projection mismatch; and
- model failure reaching the client.

## Conformance requirements

An implementation conforms when one command:

1. runs every scenario without credentials, network access, real waiting, or a live model;
2. validates all public inputs, responses, stream messages, and final outputs;
3. persists each valid canonical event before making it deliverable;
4. produces the expected applied sequence, terminal state, result, or stable error;
5. never applies a duplicate or an event beyond a gap;
6. reconnects and retries without repeating model work;
7. distinguishes connection loss from explicit cancellation;
8. reconciles every successful final result with its accepted application events; and
9. exits non-zero if any scenario fails.

Generated TypeScript and Dart clients must expose event types as a discriminated union, retain unknown raw transport diagnostics separately from typed state, and make terminal states exhaustive.

## Comparison record

| Measure | Method |
| --- | --- |
| Hand-written source lines | Workflow, persistence adapter, server transport, generated-client boundary, reducer, and tests |
| Contract duplication | Public fields declared in more than one source of truth |
| Reconnect fidelity | Whether a reconnect repeats model work or loses an accepted event |
| Reducer safety | Duplicate and gap behavior before UI state changes |
| Final consistency | Whether streamed projections equal every successful result |
| Cancellation safety | Terminal-event count and late provider-output handling |
| Version behavior | Whether unsupported clients fail before execution |
| Data minimization | Whether inputs or provider internals enter the public log |
| Test isolation | Whether conformance runs without network, credentials, model, or sleep |

Generated files and lockfiles are excluded from source-line and duplication counts. Record runtime versions, transport choice, persistence choice, and exact counting commands.

## Out of scope

- UI layout, platform widgets, and background-notification design
- Choosing SSE, WebSocket, HTTP/2, or another transport
- Production datastore and multi-region replication
- Token-by-token provider wire formats
- Offline creation before the device can reach the server
- Editing a completed briefing
- Tool calls, human approval, and side effects
- Finalizing a cancellation-capable internal execution-event schema

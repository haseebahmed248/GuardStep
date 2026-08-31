# Support approval benchmark

Status: Stage 0 benchmark contract. This is not a GuardStep language specification.

This benchmark compares how implementations express a support workflow that can read account context, propose a sensitive action, suspend for human approval, and resume without repeating earlier effects. It is intentionally framework-independent and deterministic.

The conformance suite uses the accounts and effect responses in [`fixtures`](fixtures/) instead of a live identity service or model. Production authentication, storage, and user interfaces are outside this contract.

## Workflow

An implementation receives a support ticket and performs these steps:

1. Confirm that the host granted the `support.account.read` capability.
2. Call `support.account.lookup` once for the input workspace and target user.
3. Reject account context whose workspace or user does not exactly match the input.
4. Ask the configured model for a structured action plan: `respond_only` or `disable_mfa`.
5. Validate the plan and check active-duration and model-cost budgets.
6. Return a normal response immediately for `respond_only`.
7. For `disable_mfa`, create an approval request for a workspace owner and suspend the run.
8. On a valid denial, return a normal `declined` result without calling the mutation tool.
9. On a valid approval, check `support.account.disable_mfa`, call the mutation once, validate its target, and return the operation ID.

The public contracts are:

- [`input.schema.json`](schemas/input.schema.json) for a new run;
- [`suspension.schema.json`](schemas/suspension.schema.json) for the value returned while approval is pending;
- [`resume.schema.json`](schemas/resume.schema.json) for the host-authenticated approval decision; and
- [`output.schema.json`](schemas/output.schema.json) for a completed business result.

The resume value is an authenticated host signal, not an untrusted browser payload passed directly to the workflow. The host is responsible for authenticating the approver and supplying verified roles.

## Model request

The model receives the ticket request and the account record returned for that run. It must return exactly:

```text
action: respond_only | disable_mfa
reason: non-empty string
message: non-empty string
```

The request must tell the model that it only proposes an action. The model cannot grant capabilities, choose the approver, approve its own plan, or invoke the mutation. Host policy maps `disable_mfa` to a required `workspace_owner` approval.

## Approval binding

Suspension is a durable execution boundary, not a synchronous callback. The approval request binds these values:

- run ID;
- approval ID;
- stable step ID `approval:disable-mfa`;
- workspace ID and target user ID;
- requested role `workspace_owner`;
- a SHA-256 digest of the canonical action, workspace, and target; and
- an expiry of 24 hours.

An accepted resume signal must match the stored run, approval, step, and digest. A mismatch returns `APPROVAL_SIGNAL_INVALID`, leaves the run suspended, emits no new workflow event, and never reaches the mutation tool. An expired request fails with `APPROVAL_EXPIRED`.

Approval summaries contain only the action and stable identifiers. They must not expose the original request, account fields, model reasoning, credentials, or secrets.

The approval wait is not counted toward active execution duration. Resuming continues the stored run after the approval step; it must not repeat account lookup or model generation.

## Effects and authority

| Effect | Required capability | Maximum calls |
| --- | --- | ---: |
| `support.account.lookup` | `support.account.read` | 1 |
| model generation | model budget | 1 |
| `support.account.disable_mfa` | `support.account.disable_mfa` | 1 |

Approval is a runtime suspension primitive, not a tool capability. Approval does not replace the mutation capability check: the host checks `support.account.disable_mfa` after a valid approval and immediately before the mutation.

The mutation receives a stable idempotency key derived from the run and approval IDs. Replaying an already-consumed approval returns the stored output, emits no new events, and does not call the mutation again.

## Budgets

| Limit | Value |
| --- | ---: |
| Total tool calls | 2 |
| Model calls | 1 |
| Active execution duration | 20,000 ms |
| Model cost | USD 0.05 |
| Approval expiry | 86,400,000 ms |

Fixture time is simulated by each reached effect's `elapsed_ms`; tests must not sleep. Approval wait time is excluded. Model cost is calculated from the fixed price table in [`scenarios.json`](fixtures/scenarios.json); conformance tests must not fetch provider prices.

Call-count and duration limits are checked before and after each effect. Cost is checked when model usage returns. A completed effect is recorded before a resulting budget failure, and no later effect may start after a terminal failure.

## Failure contract

Messages and framework-native exception shapes are not compared. Stable codes are:

| Code | Required condition |
| --- | --- |
| `CAPABILITY_DENIED` | A reached read or mutation capability was not granted |
| `ACCOUNT_LOOKUP_TIMEOUT` | The account lookup fixture reports a timeout |
| `ACCOUNT_CONTEXT_MISMATCH` | Lookup returns a different workspace or target user |
| `MODEL_OUTPUT_INVALID` | The model result is not a valid action plan |
| `APPROVAL_EXPIRED` | The stored approval expires before a valid decision |
| `APPROVAL_SIGNAL_INVALID` | Resume authentication or binding validation fails; the run remains suspended |
| `MUTATION_TIMEOUT` | The approved mutation fixture reports a timeout |
| `MUTATION_RESULT_MISMATCH` | Mutation returns a different workspace or target user |
| `COST_LIMIT_EXCEEDED` | Recorded model usage costs more than USD 0.05 |
| `DURATION_LIMIT_EXCEEDED` | Simulated active time exceeds 20,000 ms |

Human denial is not a workflow failure. It produces a successful business result with status `declined` and no mutation.

## Suspension state machine

```text
running
  ├─ respond_only ──────────────────────────────> succeeded
  ├─ failure ───────────────────────────────────> failed
  └─ disable_mfa ─> approval requested ────────> suspended
                                              ├─ invalid signal ─> suspended
                                              ├─ expired ────────> failed
                                              ├─ denied ─────────> succeeded (declined)
                                              └─ approved
                                                   ├─ failure ───> failed
                                                   └─ mutation ──> succeeded (executed)
```

A terminal run cannot be resumed. A valid approval is consumed exactly once.

## Event contract and version boundary

Events before suspension and after resume use the envelope and lifecycle rules in the [minimum execution event model](../../docs/EXECUTION-EVENTS.md). This benchmark identifies four portable lifecycle types needed for approval:

```text
approval.requested
run.suspended
run.resumed
approval.resolved
```

These types are deliberately **not** added to `execution-event.v1.schema.json`. That schema has a closed type set, and approval was explicitly deferred. A future event-schema version must define their payloads before this workflow becomes a canonical event conformance suite.

The candidate order for an approved run is:

```text
run.started
capability.checked
tool.started
tool.succeeded
model.started
model.succeeded
approval.requested
run.suspended
run.resumed
approval.resolved
capability.checked
tool.started
tool.succeeded
run.succeeded
```

Denied and expired decisions emit `run.resumed` and `approval.resolved`, then finish without a mutation. A resume request rejected at the API boundary emits no workflow events because execution never resumes.

## Scenarios

[`scenarios.json`](fixtures/scenarios.json) is the source of truth for granted capabilities, deterministic effects, approval decisions, expected results, call counts, and candidate event sequences.

Check the fixture set with:

```bash
node benchmarks/support-approval/validate-fixtures.mjs
```

The suite covers:

- a response that needs no approval;
- a run left suspended;
- approved, denied, expired, and tampered approval paths;
- idempotent replay after a successful mutation;
- denied read and mutation capabilities;
- lookup and mutation timeouts;
- lookup and mutation target mismatches;
- malformed model output; and
- model-cost and active-duration limits.

## Conformance requirements

An implementation conforms when one command:

1. runs every scenario without credentials, network access, or real waiting;
2. validates public inputs, action plans, suspensions, resume signals, outputs, and events;
3. produces the expected output, suspension, rejection, or stable failure code;
4. produces the exact `required_events` sequence;
5. performs no effect after a terminal failure or rejected resume;
6. resumes without repeating lookup or model work;
7. executes an approved mutation at most once, including after replay; and
8. exits non-zero if any scenario fails.

Implementations may use extra internal state, but they must not weaken the public contracts or allow model output to bypass host policy.

## Comparison record

| Measure | Method |
| --- | --- |
| Hand-written source lines | Non-blank, non-comment lines for workflow, persistence boundary, contracts, adapters, and tests |
| Contract duplication | Number of public fields declared in more than one source of truth |
| Approval safety | Whether invalid, denied, and expired decisions can reach the mutation |
| Resume fidelity | Whether lookup and model effects are reused rather than repeated |
| Exactly-once effect | Whether replay can invoke the mutation more than once |
| Static failures | Which benchmark failures are caught before execution |
| Runtime failures | Whether every expected failure has its stable code |
| Trace completeness | Whether every scenario emits the required portable sequence |
| Test isolation | Whether conformance tests run without credentials, network, or sleep |

Generated files and lockfiles are excluded from source-line and duplication counts. Record runtime versions and the exact counting command with the results.

## Out of scope

- A production identity provider or MFA implementation
- Approval UI, email, SMS, or chat delivery
- Choice of database, queue, or durable-execution engine
- Live model quality evaluation
- Organization-specific legal or support policy
- Multi-party or quorum approval
- Revoking an approval after its mutation completed
- Finalizing the next execution-event schema version

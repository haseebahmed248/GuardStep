# RFC 0002: typed workflow branching

Status: proposed; implementation is subject to review, not a released guarantee.
Related: #20. Public discussion: [#51](https://github.com/haseebahmed248/GuardStep/issues/51).
Public review period: September 7–14, 2026. The founding maintainer
will record the outcome and unresolved concerns here before merging the feature.

## Motivation

Document Q&A should be able to return early or fail when retrieval is empty,
without asking a host adapter to choose the workflow's control flow. Decisions
must preserve the same type checks, authority and budgets as linear steps.

## Syntax and supported subset

Complete minimal example:

```guard
enum Failure { DENIED DURATION COST }
record Input { text: String }
workflow Decide(input: Input) -> Input fails Failure {
  capabilities {}
  limits {
    tool_calls <= 0
    model_calls <= 0
    duration <= 1s else DURATION
    cost <= 0 USD else COST
  }
  if input.text == "" {
    fail DENIED
  } else {
    return input
  }
}
```

Conditions use existing pure boolean expressions. Braces are mandatory. Nested
`if`, optional `else`, and `else if` are supported. `fail CODE` terminates the
whole workflow with a value from its declared failure enum. An omitted else is
an empty fallthrough branch. Policy blocks remain workflow-level only.

Variables introduced in an arm are local to that arm and its nested blocks.
They cannot shadow visible variables. Sibling arms may use the same names, even
with different types; neither binding exists after the branch. Every return
must match the declared output record. No implicit branch-result assignments.

There is **no union/optional type narrowing in this slice**: those types do not
exist in the executable language. An enum equality test does not change a
record's fields or make a String nullable. Narrowing needs a separate type-system
proposal; this implementation must not pretend it is available.

## Final paths and diagnostics

All syntactic paths must end in `return` or `fail`. Both arms are checked even
for literal conditions; no constant folding or correlated-condition proof.

- `if true { return input }` without a final return/else is incomplete (GS2202).
- A non-boolean condition is rejected (GS2201).
- A statement after return/fail or an if whose arms both terminate is unreachable
  (GS2203). A statement after an if with a fallthrough arm is reachable.
- Returning a different record in one arm is incompatible (GS2202).
- Referencing an arm-local value after its block is unknown (GS2101).
- An undeclared failure is rejected (GS2003), even in an unselected arm.
- Effects inside conditions remain forbidden (GS2004).

## IR and compatibility

Linear programs keep their existing version 1 JSON and step IDs. Programs using
`if` or standalone `fail` emit version 2. Version 2 adds a `branch` node with
`condition`, `then`, `else`, source range and step ID, plus a `fail` node with its
error code. No closures, evaluated source, adapter calls or executable JS in IR.

Branch and v2 assertion IDs use deterministic statement indices within their enclosing block;
arm paths qualify all nested IDs, so sibling assignment names cannot collide.
The compiler API returns `WorkflowIr` (v1 | v2); explicit v1 consumers must check
the version. The updated runtime accepts v1/v2 and rejects unsupported versions
before any effects. Older runtimes must not be used with v2; the current npm
alpha's old runtime is not a v2 consumer. Execution-event schema stays v1;
selected effects carry arm-qualified IDs, and fail uses `run.failed`.

Generated domain/workflow/tool contracts stay unchanged for linear inputs. Model
contracts include calls in every arm, inferred in their lexical environment;
branch-local model symbols include the branch path. Unchosen arms do not invoke
their host or model adapter.

## Authority and budgets

All arms require declared capabilities statically. Runtime grants are checked
only when a tool is actually reached. Runtime counters, cost and absolute
deadline are shared by all selected blocks; entering a branch never resets them.

Static call limits use a conservative maximum over paths, not a sum of mutually
exclusive arms. A terminating arm does not also pay for later continuation
steps. Sequential branches can accumulate calls. Analysis summarizes maximum
and fallthrough counts separately in linear time, without enumerating paths.

Budget enforcement runs at control-flow boundaries and before terminal results.
An already exhausted deadline cannot dispatch a new effect, including at exact
deadline equality. The deadline helper rechecks at dispatch to cover time spent
evaluating arguments and scheduled microtasks. Cost may exceed the cap during
one already-started model call; its measured charge prevents later effects.
This is not a prepaid billing guarantee or a sandbox for untrusted adapters.

## Alternatives and open concerns

- Host-only decisions hide control flow from checking and budget analysis.
- A match expression would need exhaustiveness and result-type rules beyond
  this small subset; a future RFC can add it.
- Exporting branch-local values requires a join/definite-assignment design.
- Keeping IR v1 would let old consumers misinterpret new node kinds.
- Dedicated branch trace events are deferred; assess whether arm-qualified
  effect IDs plus terminal events are enough for consumers.
- No loops, retries, try/catch, unions, literal narrowing or branch result values.

## Conformance and rollout

Test true/false/nested/else-if/failure paths; early returns; incomplete and
unreachable paths; incompatible results and local scopes; worst-path budgets;
denied grants; accumulated time/cost/call limits; deterministic roundtripped IR;
generated model contracts and CLI check/run/test. Retain all linear fixtures.
Ship source documentation and a runnable keyless example. Do not publish a new
npm version or merge this proposal as accepted until the review outcome is recorded.

## Outcome

Pending public review. No acceptance decision has been recorded.

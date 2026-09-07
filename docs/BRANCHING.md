# Workflow branching (source preview)

This checkout implements [RFC 0002](rfcs/0002-typed-workflow-branching.md), pending
public review in [#51](https://github.com/haseebahmed248/GuardStep/issues/51).
It is not available in `guardstep@0.1.0-alpha.1`. This is experimental, not a
production-readiness claim.

## Run the keyless example

From the repository root with Node.js 22 or newer:

```sh
npm ci
npm run build
./gs check examples/branching/decide.guard
./gs run examples/branching/decide.guard
./gs test examples/branching/decide.guard
```

The adjacent input and host files are discovered automatically. No model key,
Ollama server, account or paid service is needed: the model is a deterministic
fixture. The five cases cover empty-input failure, cached early return,
model-only execution, tool-then-model execution and permission denial.

The default output is `{ "text": "[mock model] [tool] hello" }`. Changing the
input text to `cached` returns without calling any adapter. `local` calls only
the mock model; empty text fails with `EMPTY`.

## Semantics

- `if condition { ... }`, optional `else { ... }`, nested branches and `else if`.
- Conditions must be pure booleans. Comparisons and existing list predicates
  work; truthiness and calls inside conditions do not.
- `return value` succeeds with the declared output record. `fail CODE` fails
  with a member of the workflow's failure enum. Both terminate the whole run.
- Every path must return or fail. An if without else may fall through to a
  later return. Statements after an unconditional terminal are rejected.
- Variables are local to each arm. Arms can read outer bindings, but cannot
  shadow them or export new bindings. Siblings may reuse local names.
- All arms are checked, even with literal conditions. No constant folding,
  correlated-condition proof, union narrowing, nullable types or implicit joins.
- Capabilities and limits are declared once at workflow scope. Runtime grants
  are checked only for selected tool calls. Counters, time and costs accumulate
  across selected blocks; they do not reset on entry or exit.
- Static call limits use the maximum per path, including shared continuation,
  rather than adding mutually exclusive arms. Model cost is accounted after a
  completed call; the cap cannot undo a charge already incurred.

## Version and contract compatibility

Linear sources still emit IR v1 with unchanged IDs and generated contracts.
Branching or standalone fail emits IR v2. `compileSource` now returns
`WorkflowIr` (`WorkflowIrV1 | WorkflowIrV2`); callers requiring v1 must narrow
`schema_version`. The runtime and generator accept both versions. Unsupported
versions and v2 steps mislabeled as v1 are rejected before execution.

Use a compiler and runtime from the same checkout for this preview. The old npm
runtime predates v2 and is not a compatible consumer. IR is trusted compiler
output, not a safe format for executing arbitrary untrusted JSON or adapters.

Nested step IDs include the branch index and arm, such as
`Decide/branch:0/else/model:reply`. Generated model contracts visit every arm
with its lexical context and give branch-local models path-qualified names.
Existing event schema v1 is unchanged; there is no new branch event. Selected
effects retain their qualified step IDs, and terminal failures emit `run.failed`.

Run `npm run check` and `npm run check:generated` to verify both checked-in
examples and their typed host contracts.

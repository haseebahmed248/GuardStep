# GuardStep syntax options

Status: Stage 0 design experiment. Neither option is a specification or an implementation commitment.

This document compares two surface syntaxes for the same workflow semantics:

1. a standalone, workflow-first language in `*.guard` files; and
2. an embedded TypeScript API in `*.workflow.ts` files.

The complete drafts are [`answer.guard`](../examples/document-qa/answer.guard) and [`answer.workflow.ts`](../examples/document-qa/answer.workflow.ts). Both encode the [document Q&A benchmark](../benchmarks/document-qa/README.md); differences below are intended to be surface and tooling differences, not behavioral ones.

## Shared semantic requirements

Both options must lower to the same versioned workflow IR and support the same runtime contract:

- public, serializable input and output types;
- an explicit `documents.search` capability that the host must grant;
- one tool call and one model call with the unmodified question;
- duration and model-cost budgets;
- provider-neutral model profiles;
- structured model output validated before assignment;
- stable failure codes with deterministic precedence;
- status-specific citation postconditions and exact source matching; and
- the same portable event sequence without document content or secrets.

Syntax convenience must not weaken these requirements. In particular, TypeScript callbacks may not turn untracked network or filesystem access into invisible workflow effects.

## Option A: standalone workflow blocks

```guardstep
workflow AnswerQuestion(input: Question) -> Answer fails FailureCode {
  capabilities {
    documents.search else CAPABILITY_DENIED
  }

  limits {
    tool_calls <= 1
    model_calls <= 1
    duration <= 20s else DURATION_LIMIT_EXCEEDED
    cost <= 0.05 USD else COST_LIMIT_EXCEEDED
  }

  documents = call documents.search(question: input.question)
    on timeout => fail SEARCH_TIMEOUT

  answer = generate Answer using model("balanced") {
    instructions: """
      Answer the question using only the supplied documents.
      Return answered only when the documents support the answer.
      Return insufficient_context when the documents do not support an answer.
      For an answered result, copy every citation ID, title, and URL from a supplied document.
    """
    context: {
      question: input.question
      documents: documents
    }
  } on invalid => fail MODEL_OUTPUT_INVALID

  require answer.status != answered || answer.citations.length > 0
    else CITATION_REQUIRED
  require answer.status != insufficient_context || answer.citations.length == 0
    else CITATION_FORBIDDEN
  require answer.citations.every(citation => documents.any(document =>
    document.id == citation.document_id &&
    document.title == citation.title &&
    document.url == citation.url
  )) else CITATION_UNKNOWN

  return answer
}
```

### Intended properties

- Effects are syntactically visible through `call` and `generate`.
- The compiler can reject undeclared tools, unsupported units, missing returns, invalid fields, and effects in pure expressions without a lint plugin.
- The source maps directly to a portable IR; executing user-authored JavaScript is not required to discover the graph.
- A formatter and language server must be built before the authoring experience is credible.
- Users must learn a new grammar and use escape hatches for application-specific pure logic.

### Example diagnostics

```text
answer.guard:42:14 GS2103 capability not declared
  call billing.refund(...)
       ^^^^^^^^^^^^^^
Declare billing.refund in the workflow capabilities block.
```

```text
answer.guard:50:10 GS1307 citation has no field "documentId"
Did you mean "document_id"?
```

## Option B: embedded TypeScript workflow API

```ts
export const AnswerQuestion = gs.workflow({
  name: "AnswerQuestion",
  input: Question,
  output: Answer,
  failures: FailureCode,
  capabilities: [
    gs.grant(documentsSearch, { denied: "CAPABILITY_DENIED" }),
  ],
  limits: {
    toolCalls: 1,
    modelCalls: 1,
    duration: gs.seconds(20, "DURATION_LIMIT_EXCEEDED"),
    cost: gs.usd(0.05, "COST_LIMIT_EXCEEDED"),
  },
}).define(async ({ input, effect, require }) => {
  const documents = await effect.call(
    documentsSearch,
    { question: input.question },
    { timeout: "SEARCH_TIMEOUT" },
  );

  const answer = await effect.generate({
    output: Answer,
    model: gs.model("balanced"),
    instructions: documentQaInstructions,
    context: { question: input.question, documents },
    invalid: "MODEL_OUTPUT_INVALID",
  });

  require(
    answer.status !== "answered" || answer.citations.length > 0,
    "CITATION_REQUIRED",
  );
  require(
    answer.status !== "insufficient_context" || answer.citations.length === 0,
    "CITATION_FORBIDDEN",
  );
  require(
    answer.citations.every((citation) =>
      documents.some((document) =>
        document.id === citation.document_id &&
        document.title === citation.title &&
        document.url === citation.url
      )
    ),
    "CITATION_UNKNOWN",
  );

  return answer;
});
```

### Intended properties

- Existing TypeScript editors immediately provide formatting, navigation, refactoring, and ordinary type errors.
- Developers can reuse application types, pure functions, package management, and test tools.
- The API can require model and tool effects to pass through `effect`, but TypeScript itself cannot prevent `fetch`, filesystem access, clocks, randomness, or provider SDK calls inside the callback.
- Producing a portable graph without running arbitrary module initialization requires constraints, a build transform, or a registration phase.
- TypeScript version and module-system compatibility become part of the product surface.

### Example diagnostics

Ordinary shape errors come from TypeScript:

```text
Property 'documentId' does not exist on type 'Citation'.
Did you mean 'document_id'?
```

GuardStep policy errors would require a checker or lint/build plugin:

```text
answer.workflow.ts:61:20 GS3102 untracked effect inside workflow
  const response = await fetch(url)
                         ^^^^^
Use effect.call with a declared tool, or move this operation outside the workflow.
```

## Direct comparison

| Concern | Standalone `.guard` | Embedded `.workflow.ts` |
| --- | --- | --- |
| Effect visibility | Enforced by grammar and checker | Enforced only for API calls; escape paths require analysis or policy |
| Portable IR | Direct compiler output | Requires registration, restricted evaluation, or source transform |
| Initial tooling | Parser, formatter, and LSP must be built | TypeScript tooling works immediately |
| Type ecosystem | GuardStep types with generated host bindings | Native TypeScript types and packages |
| Diagnostics | Domain-specific and source-located | Excellent type diagnostics; policy diagnostics need extra tooling |
| Metaprogramming | Intentionally limited | Powerful, but can make workflows harder to inspect statically |
| Runtime portability | Host-language independent by design | Compiler/build step depends on JavaScript tooling |
| Learning cost | New language concepts and syntax | Familiar syntax; new workflow API and restrictions |
| Formatting and review | One canonical formatter can minimize style variation | Existing formatters work, but callback style can vary widely |
| Security boundary | Closed-world source is easier to audit | Arbitrary imports and ambient authority are harder to exclude |

## Semantics that must not depend on the option

### Capabilities

Declaration is not authorization. Compilation records a capability manifest; the host grants a subset at invocation. A missing grant fails before a tool event.

### Budgets

Call budgets are checked before effects. Duration and cost are checked after recording the completed effect, matching the benchmark event order. Currency budgets use deployment pricing metadata rather than model prices embedded in source.

### Failures

`fails FailureCode` and `failures: FailureCode` declare the public failure set. Each effect or assertion maps framework/provider failures to a declared stable code. Undeclared failure codes are compile errors.

Failure precedence follows source execution and the benchmark contract: capability denial; tool failure or post-tool duration; model structure; citation assertions; post-model duration; then model cost. A later check cannot replace an earlier terminal failure.

### Model context

Only values placed in `context` reach the model. The runtime injects the requested output schema and validates the response before the workflow can read it.

### Events

The compiler assigns stable step IDs. Runtime events are derived from effects, assertions, budgets, and terminal state; users do not manually emit lifecycle events required by the [minimum execution event model](EXECUTION-EVENTS.md).

## Decision experiment

Do not choose from aesthetics alone. Build the smallest spike of each option that can lower the document Q&A workflow to the same hand-authored IR fixture, then record:

1. source lines and duplicated contract fields;
2. implementation effort for parser/checker versus TypeScript API/transform;
3. diagnostics for ten seeded type, capability, effect, and return-path errors;
4. whether an undeclared network call can reach execution;
5. whether graph extraction runs arbitrary user code;
6. editor setup and cold-start time;
7. provider and runtime swaps without workflow-source changes; and
8. comprehension and modification time for at least five product engineers unfamiliar with GuardStep.

The standalone option should win only if its static safety, portability, and readability justify owning a language toolchain. The embedded option should win only if it can preserve effect visibility and deterministic IR generation without becoming a fragile TypeScript convention.

## Deferred syntax details

- module/import syntax;
- generics and reusable workflow functions;
- pattern matching syntax;
- prompt-template reuse and localization;
- retry, fallback, parallel, approval, and suspension syntax;
- secret-handle syntax;
- visibility and package boundaries; and
- provider-specific extension syntax.

These details should be tested with the [support-approval](../benchmarks/support-approval/README.md) and [mobile-streaming](../benchmarks/mobile-streaming/README.md) requirements before either option is frozen.

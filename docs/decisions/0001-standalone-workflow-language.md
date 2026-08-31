# ADR 0001: Use a standalone workflow language for the executable slice

- Status: Accepted for Stage 1
- Date: 2026-08-31
- Scope: Initial executable GuardStep slice; surface syntax remains provisional

## Context

GuardStep's proposed value depends on statically visible effects, reviewable capability manifests, portable workflow IR, provider-neutral execution, and generated web/mobile contracts. Two source forms were considered: standalone `.guard` files and an embedded TypeScript callback API.

The Stage 0 [evidence report](../STAGE-0-REPORT.md) found that plain TypeScript, BAML with TypeScript orchestration, and LangGraph can all satisfy the document Q&A contract, but each leaves the cross-effect safety policy and portable event contract in application code. The embedded syntax draft also permits ambient TypeScript effects unless GuardStep adds a restrictive transform and module policy.

## Decision

Build the Stage 1 executable slice as a standalone `.guard` language that lowers directly to versioned, serializable IR.

The initial subset will be deliberately small. It will support only the types, effects, assertions, budgets, branches, and terminal behavior needed for document Q&A. Unsupported constructs fail at compile time. Host applications integrate through generated contracts and declared tool/provider adapters, not arbitrary code inside a workflow.

This decision does not freeze grammar details, choose the final parser library, or authorize building later-stage features before the Stage 1 proof gates pass.

## Consequences

Positive consequences:

- effect visibility can be enforced structurally;
- IR extraction does not evaluate application modules;
- source is independent of TypeScript runtime semantics;
- capability and failure declarations can be complete and reviewable; and
- TypeScript and later Dart contracts can share one workflow source.

Negative consequences:

- the project owns parser, formatter, diagnostics, and editor tooling;
- users learn a new syntax;
- reuse of application-specific pure logic needs explicit boundaries; and
- useful results arrive later than with a library-only prototype.

## Reconsideration triggers

Reopen this decision if the executable slice:

- needs unrestricted host-language callbacks to express the reference workflows;
- cannot extract deterministic IR without executing user code;
- cannot provide source-located diagnostics materially better than a TypeScript library;
- duplicates public contracts instead of generating them;
- fails the document Q&A conformance suite; or
- shows no meaningful authoring reduction once shared runtime code is separated from application code.

An embedded TypeScript API remains the fallback. If adopted later, it must explicitly document which effect-safety and portability guarantees are weakened or replaced.

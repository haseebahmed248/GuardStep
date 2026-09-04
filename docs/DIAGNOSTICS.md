# Diagnostics

GuardStep diagnostics are designed for people, editors, and automation. Every compiler diagnostic includes a stable code, severity, message, source path, and source range.

## Compatibility

Diagnostic codes are part of the compiler interface. Removing a code, reusing it for a different condition, or changing which code represents an existing condition is a breaking change for tools that consume GuardStep diagnostics. Before `1.0`, such a change must be called out in release notes and accompanied by updated fixtures.

Adding a code for a newly rejected invalid program is a behavioral change, but does not change the meaning of existing codes. Message wording may be clarified without changing a code when the underlying condition is unchanged. Source ranges may become more precise, but unexpected movement must remain visible in corpus review.

## Seed corpus

The reusable corpus lives in `fixtures/diagnostics`. Its versioned manifest records exact diagnostic codes, messages, and ranges. The same fixtures run through both the compiler API and the CLI, without a network connection or model provider.

The initial proof gates are:

| Code | Condition |
| --- | --- |
| `GS1204` | unsupported duration unit |
| `GS2002` | tool call without a declared capability |
| `GS2003` | failure outside the workflow failure set |
| `GS2004` | effect attempted inside a pure expression |
| `GS2102` | invalid field access |
| `GS2202` | workflow without a return |

When adding or intentionally changing a diagnostic, update the smallest relevant `.guard` fixture and its manifest entry in the same pull request.

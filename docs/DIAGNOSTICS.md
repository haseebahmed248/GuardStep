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
| `GS1101` | duplicate declaration or entry, including limits, tool arguments, and model context keys |
| `GS1204` | unsupported duration unit |
| `GS2002` | tool call without a declared capability |
| `GS2003` | failure outside the workflow failure set |
| `GS2004` | effect attempted inside a pure expression |
| `GS2102` | invalid field access |
| `GS2105` | incompatible expression operands, including unsupported ordering |
| `GS2201` | non-boolean assertion or branch condition |
| `GS2202` | missing final-result path or incompatible return type |
| `GS2203` | unreachable statement after return, fail, or an exhaustive terminal branch |

When adding or intentionally changing a diagnostic, update the smallest relevant `.guard` fixture and its manifest entry in the same pull request.

## Duplicate entries

Each limit name, named tool argument, and model context key may appear only
once in its block or call. A repeated key produces `GS1101` at that key's
source location before its value can replace the earlier entry. This applies
even when both values are identical. Unique entries may be reordered, and
names may be reused in separate calls, context blocks, or workflow limits.

## Comparison operands

Ordering operators (`<`, `<=`, `>`, `>=`) require matching numeric or
string-backed types. `String`, `Url`, and values of the same enum remain
orderable using the runtime's existing string comparisons. Booleans, records,
and lists are rejected during semantic checking with `GS2105`, rather than
throwing during workflow execution. Equality (`==`, `!=`) retains its existing
matching-type rules; this check does not add coercion or change equality.

## Null tool arguments

`null` remains a valid literal for model context, where providers may need to
distinguish an explicit null from an omitted key. Tool parameters are
non-nullable, so passing `null` where a tool declares `String` is rejected
during semantic checking with `GS2105`.

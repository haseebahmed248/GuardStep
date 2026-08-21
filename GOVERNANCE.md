# Governance

This is the governance model for the design phase. It can be amended through the same public RFC process used for other major changes.

## Values

- Technical decisions are documented publicly.
- Maintainer authority follows sustained, constructive contribution.
- Compatibility and user safety outweigh novelty.
- No hosted product receives private control over the open language specification.
- Implementations may compete while sharing language and IR standards.

## Decision process

Routine fixes use normal pull-request review. Major changes use a public RFC with a stated review period, unresolved concerns, and a recorded outcome.

Maintainers seek rough consensus. Until more maintainers are appointed, the founding maintainer decides unresolved questions and records the reasons. Decisions can be revisited when new evidence appears.

## Maintainers

The founding maintainer reviews and releases the initial project. New maintainers may be nominated after sustained contributions across code, design, documentation, or community work. Existing maintainers approve additions publicly.

Maintainers who become inactive should step down or be moved to emeritus status so permissions reflect actual responsibility.

## Language changes

Accepted language changes must include:

- motivating use cases;
- syntax and semantics;
- diagnostics and failure behavior;
- compatibility impact;
- security considerations; and
- conformance tests.

The specification and conformance tests, not one runtime's incidental behavior, will become the source of truth after the public preview.

## Releases

Before `1.0`, breaking changes are permitted but must be documented. A formal stability and deprecation policy is required before `1.0`.

## Commercial participation

Commercial use and commercial contributions are welcome under Apache License 2.0. Paid services must not be required to use the compiler, specification, or local runtime.

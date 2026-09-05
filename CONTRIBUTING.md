# Contributing

GuardStep is still in research and design. Concrete use cases and design criticism are more useful than large implementations at this stage.

## Ways to contribute

- Describe a real AI workflow and the failure cases it must handle.
- Compare the proposal with an existing language or framework.
- Challenge a security, type-system, or runtime assumption.
- Propose syntax with examples and counterexamples.
- Improve documentation and reference applications.
- Implement an issue that maintainers have marked ready.

## Before writing a large change

Open a public proposal first. Explain:

1. the problem and affected users;
2. examples showing current friction;
3. proposed semantics, not only syntax;
4. alternatives considered;
5. security, portability, and compatibility effects; and
6. how the behavior will be tested.

Major language, IR, runtime, security, and governance changes require an RFC before implementation.

## Contribution workflow

1. Search existing issues and proposals.
2. Open or claim a narrowly scoped issue.
3. Add tests for behavioral changes once a test harness exists.
4. Keep commits focused and explain design tradeoffs in the pull request.
5. Update relevant documentation.

## Development setup

GuardStep currently requires Node.js 22 or newer.

Install the project dependencies:

```bash
npm install
```

Build the project:

```bash
npm run build
```

Run the type and generated-output checks:

```bash
npm run check
```

Run the test suite:

```bash
npm test
```

The repository also provides the `./gs` wrapper for running the local GuardStep CLI:

```bash
./gs check examples/document-qa/answer.guard
./gs compile examples/document-qa/answer.guard
./gs generate examples/document-qa/answer.guard
./gs run examples/document-qa/answer.guard
./gs test examples/document-qa/answer.guard
```

The executable document-Q&A example is located at:

```text
examples/document-qa/answer.guard
```

The `./gs` wrapper is intended for repository development. Installed GuardStep packages expose the `guardstep` and `gs` commands directly.

## Documentation standard

- Separate implemented behavior from proposals.
- Link factual comparisons to primary project documentation or specifications.
- Record the date for research that can become stale.
- Prefer concrete nouns and verbs over promotional claims.
- Do not claim that GuardStep is safer, faster, or simpler without a reproducible comparison.

## Developer Certificate of Origin

Contributions use the [Developer Certificate of Origin 1.1](https://developercertificate.org/). Sign off each commit with `git commit -s` to certify that you have the right to submit the contribution under this project's license.

## Conduct

Be direct about technical disagreements while remaining respectful toward people. Harassment, discrimination, personal attacks, and deliberately unsafe contributions are not accepted. Maintainers may moderate project spaces to protect constructive participation.

## License

By contributing, you agree that your contributions will be licensed under Apache License 2.0.

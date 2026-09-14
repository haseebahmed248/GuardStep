# Security policy

GuardStep publishes experimental alpha releases on [npm](https://www.npmjs.com/package/guardstep) and [GitHub](https://github.com/haseebahmed248/GuardStep/releases). It is not ready for production use. Features on `main` may differ from the published package; include the affected version or commit in reports.

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/haseebahmed248/GuardStep/security/advisories/new) to report a suspected vulnerability to the maintainers. Do not disclose sensitive vulnerability details in public issues, pull requests, or discussions.

Include the affected package version or commit, relevant host/provider configuration, reproduction steps, and expected versus actual behavior. Use a minimal example with synthetic data; remove API keys, credentials, and private documents from attachments and logs.

This alpha policy does not establish a response-time, backport, or long-term support commitment.

## Scope and limits

The executable alpha implements:

- compiler checks for types and declared tool capabilities;
- runtime checks of host-granted tool capabilities, input/output schemas, and workflow assertions;
- call-count, duration, and model-cost budget enforcement, with cancellation signals for in-flight adapters; and
- structured execution events for reached effects and terminal outcomes.

These checks have important limits:

- **GuardStep is not a sandbox.** Host modules, tool/model adapters, and fixture-test modules are trusted application code executed with the host process's privileges. Capability grants constrain workflow tool dispatch, not arbitrary JavaScript, filesystem access, or network access in that code.
- Cancellation stops the runtime waiting and signals adapters to abort. It cannot force arbitrary adapter code to stop, undo completed side effects, or guarantee that a remote provider stops processing a request.
- Model-cost accounting depends on host-supplied pricing and provider usage. An already-started call can exceed the budget; it is not a guaranteed billing cap.
- Execution events are not a durable or tamper-proof audit log. Hosts must keep sensitive data out of adapter-supplied event metadata and application logs; GuardStep does not automatically redact arbitrary metadata.

Human approval gates, durable execution/replay, and MCP integration remain planned features, not implemented security controls. Type and schema checks do not establish that model output is truthful or that a prompt, tool, or external document is safe. Applications remain responsible for authentication, authorization, secret handling, and deployment isolation.

Security-sensitive design proposals should discuss prompt injection, data exfiltration, confused-deputy behavior, replay and duplicate effects, secret handling, authorization, denial of service, and supply-chain risk where relevant.

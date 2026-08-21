# Security policy

The project is in a design phase and does not yet publish executable releases.

## Reporting a vulnerability

Do not open a public issue for a vulnerability that could put users, credentials, or data at immediate risk. Until a dedicated private reporting address is established, contact a maintainer privately through the repository hosting platform.

The project will add a monitored security address and supported-version table before its first executable public release.

## Scope and limits

GuardStep is being designed to express capabilities, data boundaries, approval gates, and effect logs. None of these controls is implemented yet. Even when implemented, they will not make an untrusted model, prompt, tool, MCP server, or external document safe.

Security-sensitive design proposals should discuss prompt injection, data exfiltration, confused-deputy behavior, replay and duplicate effects, secret handling, authorization, denial of service, and supply-chain risk where relevant.

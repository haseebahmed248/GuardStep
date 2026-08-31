# GuardStep CLI alpha

This package contains the first executable GuardStep vertical slice:

- a lexer and recursive-descent parser for the initial `.guard` subset;
- semantic validation with stable, source-located diagnostics;
- versioned JSON-serializable workflow IR;
- deterministic TypeScript contract generation;
- a local runtime with injected tool and model adapters;
- capability, call-count, duration, cost, assertion, and output enforcement;
- portable execution-event v1 emission; and
- `check`, `compile`, local `run`, and deterministic `test` commands.

From the repository root:

```bash
npm install
npm run build
./gs check examples/document-qa/answer.guard
./gs compile examples/document-qa/answer.guard
./gs generate examples/document-qa/answer.guard
./gs run examples/document-qa/answer.guard
./gs test examples/document-qa/answer.guard
```

When installed as a package, the executable is `guardstep` with `gs` as an alias. If the current directory contains exactly one `.guard` file, its path can be omitted:

```bash
guardstep check
guardstep generate
guardstep run
guardstep test
```

`run` conventionally loads neighboring `*.input.json` and `*.host.mjs` files. A host module provides the deployment-owned capability grants, pricing, and tool/model adapters. Override those defaults with `--input`, `--host`, or `--workflow`. Host modules are trusted application code and are never loaded by `check` or `compile`.

The `test` command loads a neighboring `*.test.mjs` module. Test modules are explicitly executed test code; checking, compiling, or generating from a `.guard` file never imports or evaluates application JavaScript.

`generate` writes a neighboring `*.generated.ts` file containing domain types, typed tool and model boundaries, workflow input/output/failure mappings, capabilities, and a typed host interface. It avoids rewriting unchanged output. Use `guardstep generate --check` in CI to fail when the generated file is missing or stale. This repository exposes the same check as `npm run check:generated`.

This remains an alpha slice. The included host is a deterministic local demo, not a live AI provider. The language does not yet include modules, branching syntax, persistent execution, approval, streaming, code generation, formatting, or an LSP.

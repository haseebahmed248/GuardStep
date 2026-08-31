# GuardStep CLI alpha

This package contains the first executable GuardStep vertical slice:

- a lexer and recursive-descent parser for the initial `.guard` subset;
- semantic validation with stable, source-located diagnostics;
- versioned JSON-serializable workflow IR;
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
./gs run examples/document-qa/answer.guard
./gs test examples/document-qa/answer.guard
```

When installed as a package, the executable is `guardstep` with `gs` as an alias. If the current directory contains exactly one `.guard` file, its path can be omitted:

```bash
guardstep check
guardstep run
guardstep test
```

`run` conventionally loads neighboring `*.input.json` and `*.host.mjs` files. A host module provides the deployment-owned capability grants, pricing, and tool/model adapters. Override those defaults with `--input`, `--host`, or `--workflow`. Host modules are trusted application code and are never loaded by `check` or `compile`.

The `test` command loads a neighboring `*.test.mjs` module. Test modules are explicitly executed test code; compiling a `.guard` file never imports or evaluates application JavaScript.

This remains an alpha slice. The included host is a deterministic local demo, not a live AI provider. The language does not yet include modules, branching syntax, persistent execution, approval, streaming, code generation, formatting, or an LSP.

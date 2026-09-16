# Editor diagnostics prototype

The source checkout provides `guardstep lsp --stdio` (alias `gs lsp`).
This is not included in the published `0.1.0-alpha.1` package. No marketplace
extension is needed for clients that can launch a custom language server.

## Build and launch

From the repository root, with Node.js 22 or newer:

```sh
npm ci
npm run build
./gs lsp --stdio
```

The final command waits for LSP messages; it is not an interactive shell. An editor
should launch the built entry point directly:

```sh
node /absolute/path/to/GuardStep/packages/guardstep/dist/cli/main.js lsp --stdio
```

Do not use `npm run` as the editor command: its status banners corrupt the stdio
protocol. No API key, provider, host file, or generated contracts are required.
Rebuild after pulling changes, then restart the editor's language server.

## Neovim 0.11 or newer

Using Neovim's [built-in LSP configuration](https://neovim.io/doc/user/lsp.html#lsp-quickstart),
put this in `init.lua`. Replace the absolute checkout path and ensure `node` is
on the editor's PATH (or use its absolute path too).

```lua
vim.filetype.add({ extension = { guard = 'guardstep' } })
vim.lsp.config('guardstep', {
  cmd = { 'node', '/absolute/path/to/GuardStep/packages/guardstep/dist/cli/main.js', 'lsp', '--stdio' },
  filetypes = { 'guardstep' },
  root_markers = { '.git' },
})
vim.lsp.enable('guardstep')
```

Open `examples/branching/decide.guard`. Use `:checkhealth vim.lsp` to check that
GuardStep is attached. In an unsaved edit, replace a return value with an unknown
name: a `GS2101` diagnostic should appear. Undo the edit: the diagnostic should
clear without saving. `:lua vim.diagnostic.open_float()` shows the message.

For another LSP client, register language ID `guardstep` for `.guard` files and
use the same command array and stdio transport. There is no bundled VS Code
extension in this slice.

## Supported protocol and limits

- `initialize` / `initialized`, `shutdown` / `exit` lifecycle, with stdio only.
- `textDocument/didOpen`, `didChange`, and `didClose`; versioned push diagnostics.
- [Full-document synchronization](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#textDocument_synchronization_sc),
  not incremental edit ranges. Each change supplies the complete current text.
- Compiler diagnostic codes, severities and messages are unchanged. Compiler
  one-based positions become zero-based UTF-16 LSP positions. Valid source
  publishes an empty list; closing a tracked document also clears diagnostics.
- Unsaved/virtual documents work with language ID `guardstep`; `.guard` URIs are
  also accepted. URIs are identifiers, never paths to load or URLs to fetch.
- Out-of-order or repeated versions are ignored. A close removes tracking so a
  later reopen may start at a lower version. Malformed document notifications
  are ignored; later valid full-text changes can recover.
- Source is limited to 1,048,576 UTF-16 code units per check. Oversized documents
  and unexpected compiler failures produce a server-specific `GSLS0001` error,
  rather than appearing valid or killing the server. A later smaller/valid edit
  is checked normally. This is not a general memory or CPU sandbox: checking is
  synchronous, and the transport still receives the complete message first.
- This prototype analyzes open buffers only. No workspace scanning, disk reads,
  generated-file writes, host imports, execution, network provider calls,
  completion, hover, rename, formatting, or pull diagnostics are implemented.

## Verification

```sh
npm run build
node --test packages/guardstep/dist/test/lsp.test.js
npm run test:package
```

The protocol suite spawns the real CLI and covers the diagnostic fixture corpus,
unsaved source, edits, clearing, multiple documents, close/reopen, invalid
notifications, malformed JSON, Unicode/CRLF positions, size limits, compiler
exceptions, and lifecycle shutdown. Package validation reruns the same suite
against a separately installed tarball.

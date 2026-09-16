import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test, { type TestContext } from "node:test";
import { StreamMessageReader } from "vscode-languageserver/node";

import { compileSource, GuardStepDiagnosticError } from "../compiler/index.js";
import { GUARDSTEP_VERSION } from "../version.js";
import { loadDiagnosticCorpus } from "./diagnostic-corpus.js";

// Also run this protocol suite against the actual installed npm tarball.
const cli = process.env.GUARDSTEP_TEST_CLI ?? fileURLToPath(new URL("../cli/main.js", import.meta.url));
const valid = readFileSync(new URL("../../../../examples/branching/decide.guard", import.meta.url), "utf8");
const uri = "untitled:example.guard";

interface Message {
  readonly id?: number;
  readonly method?: string;
  readonly result?: unknown;
  readonly error?: { code: number };
  readonly params?: { uri?: string; version?: number; diagnostics?: unknown[] };
}

const startClient = (context: TestContext, args = ["lsp", "--stdio"]) => {
  const child = spawn(process.execPath, [cli, ...args], { stdio: "pipe" });
  const exited = once(child, "exit");
  const messages: Message[] = [];
  const queued: Message[] = [];
  const waiters: Array<{ matches: (message: Message) => boolean; resolve: (message: Message) => void }> = [];
  const protocolErrors: unknown[] = [];
  let stderr = "";
  child.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });
  const reader = new StreamMessageReader(child.stdout);
  reader.onError((error) => { protocolErrors.push(error); });
  reader.listen((value) => {
    const message = value as Message;
    messages.push(message);
    const index = waiters.findIndex((waiter) => waiter.matches(message));
    if (index === -1) queued.push(message);
    else waiters.splice(index, 1)[0]!.resolve(message);
  });
  context.after(async () => {
    reader.dispose();
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exited;
    assert.deepEqual(protocolErrors, [], "stdout must contain only framed protocol messages");
  });
  const next = (matches: (message: Message) => boolean): Promise<Message> => {
    const index = queued.findIndex(matches);
    if (index !== -1) return Promise.resolve(queued.splice(index, 1)[0]!);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for LSP message: ${stderr}`)), 5000);
      waiters.push({ matches, resolve: (message) => { clearTimeout(timer); resolve(message); } });
    });
  };
  const raw = (body: string): void => {
    child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  };
  const notify = (method: string, params: unknown = {}): void => {
    raw(JSON.stringify({ jsonrpc: "2.0", method, params }));
  };
  let requestId = 0;
  const request = (method: string, params: unknown = {}): Promise<Message> => {
    const id = ++requestId;
    raw(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    return next((message) => message.id === id);
  };
  const initialize = async () => {
    const response = await request("initialize", { processId: null, rootUri: null, capabilities: {} });
    assert.equal(response.error, undefined);
    notify("initialized");
    return response.result;
  };
  const open = (text: string, documentUri = uri, version = 1, languageId = "guardstep"): void => {
    notify("textDocument/didOpen", { textDocument: { uri: documentUri, languageId, version, text } });
  };
  const change = (text: string, version: number, documentUri = uri): void => {
    notify("textDocument/didChange", { textDocument: { uri: documentUri, version }, contentChanges: [{ text }] });
  };
  const diagnostics = async (documentUri = uri) =>
    (await next((message) => message.method === "textDocument/publishDiagnostics" && message.params?.uri === documentUri)).params!;
  const stop = async (): Promise<void> => {
    assert.equal((await request("shutdown")).error, undefined);
    notify("exit");
    const [code] = await exited;
    assert.equal(code, 0, stderr);
  };
  return { child, exited, messages, request, raw, notify, initialize, open, change, diagnostics, stop };
};

test("LSP initializes over stdio with only diagnostic/full-sync capabilities", { timeout: 15000 }, async (context) => {
  const client = startClient(context, ["lsp"]);
  const result = await client.initialize() as { capabilities: unknown; serverInfo: unknown };
  assert.deepEqual(result.capabilities, { positionEncoding: "utf-16", textDocumentSync: { openClose: true, change: 1 } });
  assert.deepEqual(result.serverInfo, { name: "guardstep", version: GUARDSTEP_VERSION });
  assert.equal((await client.request("unsupported/request")).error?.code, -32601);
  await client.stop();
});

test("LSP corpus diagnostics match compiler/CLI codes, messages and UTF-16 ranges", { timeout: 20000 }, async (context) => {
  const client = startClient(context);
  await client.initialize();
  let version = 1;
  for (const fixture of loadDiagnosticCorpus()) {
    if (version === 1) client.open(fixture.source);
    else client.change(fixture.source, version);
    const result = await client.diagnostics();
    assert.equal(result.version, version++);
    assert.deepEqual(result.diagnostics, fixture.diagnostics.map((diagnostic) => ({
      source: "guardstep", code: diagnostic.code, message: diagnostic.message,
      severity: diagnostic.severity === "error" ? 1 : 2,
      range: {
        start: { line: diagnostic.range.start.line - 1, character: diagnostic.range.start.column - 1 },
        end: { line: diagnostic.range.end.line - 1, character: diagnostic.range.end.column - 1 },
      },
    })), fixture.id);
  }
  await client.stop();
});

test("LSP checks unsaved content without reading disk or executing neighboring host code", { timeout: 15000 }, async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "guardstep-lsp-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "example.guard");
  const diskSource = "workflow Broken(";
  writeFileSync(path, diskSource);
  writeFileSync(join(directory, "example.host.mjs"), 'process.stdout.write("HOST EXECUTED"); process.exit(93);');
  const documentUri = pathToFileURL(path).href;
  const client = startClient(context);
  await client.initialize();
  client.open(valid, documentUri);
  assert.deepEqual((await client.diagnostics(documentUri)).diagnostics, []);
  client.change(diskSource, 2, documentUri);
  assert.equal((await client.diagnostics(documentUri)).diagnostics?.length, 1);
  client.change(valid, 3, documentUri);
  assert.deepEqual((await client.diagnostics(documentUri)).diagnostics, []);
  assert.equal(readFileSync(path, "utf8"), diskSource);
  await client.stop();
});

test("LSP close clears diagnostics and permits reopening a URI at an earlier version", { timeout: 15000 }, async (context) => {
  const client = startClient(context);
  await client.initialize();
  client.open("workflow Broken(", uri, 9);
  await client.diagnostics();
  client.open(valid, "untitled:other.guard");
  await client.diagnostics("untitled:other.guard");
  client.notify("textDocument/didClose", { textDocument: { uri } });
  assert.deepEqual(await client.diagnostics(), { uri, diagnostics: [] });
  client.change("workflow Broken(", 10);
  client.open(valid, uri, 1);
  assert.deepEqual(await client.diagnostics(), { uri, version: 1, diagnostics: [] });
  await client.stop();
  assert.equal(client.messages.filter((message) => message.method === "textDocument/publishDiagnostics").length, 4);
});

test("LSP ignores stale versions, duplicate opens, non-GuardStep files and invalid notifications, then recovers", { timeout: 15000 }, async (context) => {
  const client = startClient(context);
  await client.initialize();
  client.open(valid);
  await client.diagnostics();
  client.open("workflow Broken(");
  client.open("workflow Broken(", "file:///ignore.txt", 1, "plaintext");
  client.change("workflow Broken(", 0);
  client.change("workflow Broken(", 1);
  client.notify("textDocument/didOpen", { textDocument: null });
  client.notify("textDocument/didClose", {});
  client.notify("textDocument/didChange", { textDocument: { uri, version: 2 }, contentChanges: [{ text: 7 }] });
  client.notify("textDocument/didChange", { textDocument: { uri, version: 2 }, contentChanges: [{ text: "broken", range: {} }] });
  client.notify("textDocument/didChange", { textDocument: { uri, version: 2 }, contentChanges: [] });
  // The last of several full-text changes is the current document.
  client.notify("textDocument/didChange", { textDocument: { uri, version: 2 }, contentChanges: [{ text: "broken" }, { text: valid }] });
  assert.deepEqual(await client.diagnostics(), { uri, version: 2, diagnostics: [] });
  await client.stop();
  assert.equal(client.messages.filter((message) => message.method === "textDocument/publishDiagnostics").length, 2);
});

test("LSP preserves Unicode/CRLF diagnostic positions and CLI message parity", { timeout: 15000 }, async (context) => {
  const source = '// 💡 café\r\nrecord Input { text: String }\r\nworkflow Broken("😀"';
  const directory = mkdtempSync(join(tmpdir(), "guardstep-lsp-unicode-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "unicode.guard");
  writeFileSync(path, source);
  let expected: GuardStepDiagnosticError | undefined;
  try { compileSource({ source, sourcePath: path }); } catch (error) {
    assert.ok(error instanceof GuardStepDiagnosticError);
    expected = error;
  }
  assert.ok(expected);
  const cliResult = spawnSync(process.execPath, [cli, "check", path], { encoding: "utf8" });
  assert.equal(cliResult.status, 1);
  const client = startClient(context);
  await client.initialize();
  client.open(source);
  const result = await client.diagnostics();
  assert.deepEqual((result.diagnostics?.[0] as { range: unknown }).range, {
    start: { line: 2, character: 16 }, end: { line: 2, character: 20 },
  });
  assert.deepEqual(result.diagnostics, expected.diagnostics.map((item) => {
    assert.ok(cliResult.stderr.includes(`${path}:${item.range.start.line}:${item.range.start.column} ${item.code} ${item.message}`));
    return {
      source: "guardstep", code: item.code, severity: 1, message: item.message,
      range: { start: { line: item.range.start.line - 1, character: item.range.start.column - 1 },
        end: { line: item.range.end.line - 1, character: item.range.end.column - 1 } },
    };
  }));
  await client.stop();
});

test("LSP recovers after a malformed JSON payload in a correctly framed message", { timeout: 15000 }, async (context) => {
  const client = startClient(context);
  await client.initialize();
  client.raw("{bad json}");
  client.open(valid);
  assert.deepEqual((await client.diagnostics()).diagnostics, []);
  await client.stop();
});

test("LSP reports oversized source and recovers on a smaller edit", { timeout: 15000 }, async (context) => {
  const client = startClient(context);
  await client.initialize();
  client.open(" ".repeat(1_048_577));
  assert.equal(((await client.diagnostics()).diagnostics?.[0] as { code: string }).code, "GSLS0001");
  client.change(valid, 2);
  assert.deepEqual((await client.diagnostics()).diagnostics, []);
  await client.stop();
});

test("LSP exit without shutdown returns an error status", { timeout: 15000 }, async (context) => {
  const client = startClient(context);
  await client.initialize();
  client.notify("exit");
  assert.equal((await client.exited)[0], 1);
});

test("LSP remains usable after a compiler exception", { timeout: 15000 }, async (context) => {
  const client = startClient(context);
  await client.initialize();
  // Exceeds recursive parser stack depth, but remains below the source-size cap.
  client.open(`record Input { text: ${"List<".repeat(20000)}String${">".repeat(20000)} }`);
  assert.equal(((await client.diagnostics()).diagnostics?.[0] as { code: string }).code, "GSLS0001");
  client.change(valid, 2);
  assert.deepEqual((await client.diagnostics()).diagnostics, []);
  await client.stop();
});

test("LSP exits when its client disconnects", { timeout: 15000 }, async (context) => {
  const client = startClient(context);
  await client.initialize();
  client.child.stdin.end();
  assert.equal((await client.exited)[0], 1);
});

test("LSP rejects file/host/unsupported transport arguments before starting", () => {
  for (const args of [["example.guard"], ["--host", "evil.mjs"], ["--socket", "9000"], ["--stdio", "extra"]]) {
    const result = spawnSync(process.execPath, [cli, "lsp", ...args], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /lsp accepts only --stdio/);
  }
});

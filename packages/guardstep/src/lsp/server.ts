import {
  createConnection,
  DiagnosticSeverity,
  PositionEncodingKind,
  TextDocumentSyncKind,
  type Diagnostic,
} from "vscode-languageserver/node";

import { GUARDSTEP_VERSION } from "../version.js";
import { sourceDiagnostics } from "./diagnostics.js";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const documentIdentifier = (params: unknown): Record<string, unknown> | undefined =>
  isObject(params) && isObject(params.textDocument) ? params.textDocument : undefined;

const isVersion = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value);

const isGuardDocument = (uri: string, languageId: unknown): boolean => {
  try {
    const parsed = new URL(uri);
    return languageId === "guardstep" || parsed.pathname.endsWith(".guard");
  } catch {
    return false;
  }
};

const serverDiagnostic = (message: string): Diagnostic => ({
  source: "guardstep",
  code: "GSLS0001",
  severity: DiagnosticSeverity.Error,
  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
  message,
});

export const startLanguageServer = (): void => {
  const connection = createConnection(process.stdin, process.stdout);
  // Full synchronization means no source buffer or filesystem cache is needed.
  const versions = new Map<string, number>();
  let initialized = false;
  let stopped = false;

  connection.onInitialize(() => ({
    capabilities: {
      positionEncoding: PositionEncodingKind.UTF16,
      textDocumentSync: { openClose: true, change: TextDocumentSyncKind.Full },
    },
    serverInfo: { name: "guardstep", version: GUARDSTEP_VERSION },
  }));
  connection.onInitialized(() => { initialized = true; });
  connection.onShutdown(() => {
    stopped = true;
    versions.clear();
  });

  const invalidNotification = (): void => {
    // Do not echo malformed payloads, which may contain private source text.
    connection.console.warn("Ignored invalid GuardStep document notification; expected versioned full text.");
  };

  const publish = async (uri: string, version: number, text: string): Promise<void> => {
    let diagnostics: Diagnostic[];
    if (text.length > 1_048_576) {
      diagnostics = [serverDiagnostic("Document exceeds the prototype's 1,048,576 UTF-16 code-unit limit.")];
    } else {
      try {
        diagnostics = sourceDiagnostics(text, uri);
      } catch {
        // A compiler failure must neither kill the editor server nor imply valid source.
        diagnostics = [serverDiagnostic("Unable to check this document due to an internal compiler error. Please report a minimal reproduction.")];
      }
    }
    await connection.sendDiagnostics({ uri, version, diagnostics });
  };

  connection.onDidOpenTextDocument(async (params: unknown) => {
    if (!initialized || stopped) return;
    const document = documentIdentifier(params);
    if (document === undefined || typeof document.uri !== "string" ||
        typeof document.text !== "string" || !isVersion(document.version) ||
        typeof document.languageId !== "string") {
      invalidNotification();
      return;
    }
    if (!isGuardDocument(document.uri, document.languageId)) return;
    if (versions.has(document.uri)) {
      invalidNotification();
      return;
    }
    versions.set(document.uri, document.version);
    await publish(document.uri, document.version, document.text);
  });

  connection.onDidChangeTextDocument(async (params: unknown) => {
    if (!initialized || stopped) return;
    const document = documentIdentifier(params);
    if (document === undefined || typeof document.uri !== "string" ||
        !isVersion(document.version) || !isObject(params) ||
        !Array.isArray(params.contentChanges) || params.contentChanges.length === 0 ||
        !params.contentChanges.every((change: unknown) =>
          isObject(change) && typeof change.text === "string" && !("range" in change) && !("rangeLength" in change))) {
      invalidNotification();
      return;
    }
    const previous = versions.get(document.uri);
    if (previous === undefined || document.version <= previous) return;
    const last = params.contentChanges[params.contentChanges.length - 1] as { text: string };
    versions.set(document.uri, document.version);
    await publish(document.uri, document.version, last.text);
  });

  connection.onDidCloseTextDocument(async (params: unknown) => {
    if (!initialized || stopped) return;
    const document = documentIdentifier(params);
    if (document === undefined || typeof document.uri !== "string") {
      invalidNotification();
      return;
    }
    if (versions.delete(document.uri)) {
      await connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
    }
  });

  connection.listen();
};

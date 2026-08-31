#!/usr/bin/env node

import { readFileSync } from "node:fs";

import { formatDiagnostic, GuardStepDiagnosticError } from "../compiler/index.js";
import { parseArguments } from "./arguments.js";
import { checkCommand, compileCommand, runCommand, testCommand } from "./commands.js";
import { resolveSourcePath } from "./io.js";

const VERSION = "0.1.0-alpha.1";
const HELP = `GuardStep ${VERSION}

Usage:
  gs check [workflow.guard]
  gs compile [workflow.guard] [--out workflow.ir.json]
  gs run [workflow.guard] [--input input.json] [--host workflow.host.mjs]
  gs test [workflow.guard] [--suite workflow.test.mjs]
  guardstep version

If the current directory contains exactly one .guard file, the path may be omitted.
`;

const context = {
  stdout: (message: string): void => console.log(message),
  stderr: (message: string): void => console.error(message),
};

const main = async (): Promise<void> => {
  const command = parseArguments(process.argv.slice(2));
  if (command.command === "help") {
    context.stdout(HELP.trimEnd());
    return;
  }
  if (command.command === "version") {
    context.stdout(VERSION);
    return;
  }
  if (command.command === "check") {
    checkCommand(resolveSourcePath(command.sourcePath), context);
    return;
  }
  if (command.command === "compile") {
    compileCommand(resolveSourcePath(command.sourcePath), command.outputPath, context);
    return;
  }
  if (command.command === "run") {
    const passed = await runCommand(
      resolveSourcePath(command.sourcePath),
      command.inputPath,
      command.hostPath,
      command.workflow,
      context,
    );
    if (!passed) process.exitCode = 1;
    return;
  }
  const passed = await testCommand(resolveSourcePath(command.sourcePath), command.suitePath, context);
  if (!passed) process.exitCode = 1;
};

try {
  await main();
} catch (error) {
  if (error instanceof GuardStepDiagnosticError) {
    for (const diagnostic of error.diagnostics) {
      let source = "";
      try {
        source = readFileSync(diagnostic.sourcePath, "utf8");
      } catch {
        // A source read failure is already represented by the diagnostic path.
      }
      context.stderr(formatDiagnostic(diagnostic, source));
    }
  } else {
    context.stderr(error instanceof Error ? error.message : String(error));
  }
  process.exitCode = 1;
}

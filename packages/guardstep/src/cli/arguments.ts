export type ParsedCommand =
  | { readonly command: "help" }
  | { readonly command: "version" }
  | { readonly command: "check"; readonly sourcePath?: string }
  | { readonly command: "compile"; readonly sourcePath?: string; readonly outputPath?: string }
  | {
      readonly command: "generate";
      readonly sourcePath?: string;
      readonly outputPath?: string;
      readonly check: boolean;
    }
  | {
      readonly command: "run";
      readonly sourcePath?: string;
      readonly inputPath?: string;
      readonly hostPath?: string;
      readonly workflow?: string;
    }
  | { readonly command: "test"; readonly sourcePath?: string; readonly suitePath?: string };

const valueAfter = (argumentsValue: readonly string[], index: number, flag: string): string => {
  const value = argumentsValue[index + 1];
  if (value === undefined || value.startsWith("-")) throw new Error(`${flag} requires a value`);
  return value;
};

export const parseArguments = (argumentsValue: readonly string[]): ParsedCommand => {
  const [command, sourcePath] = argumentsValue;
  if (command === undefined || command === "help" || command === "--help" || command === "-h") {
    return { command: "help" };
  }
  if (command === "version" || command === "--version" || command === "-v") {
    return { command: "version" };
  }
  if (!["check", "compile", "generate", "run", "test"].includes(command)) {
    throw new Error(`Unknown command: ${command}`);
  }
  const hasSourcePath = sourcePath !== undefined && !sourcePath.startsWith("-");

  if (command === "check") {
    if (argumentsValue.length > (hasSourcePath ? 2 : 1)) {
      throw new Error("check accepts at most one .guard file");
    }
    return hasSourcePath ? { command, sourcePath } : { command };
  }

  let outputPath: string | undefined;
  let suitePath: string | undefined;
  let inputPath: string | undefined;
  let hostPath: string | undefined;
  let workflow: string | undefined;
  let checkGenerated = false;
  for (let index = hasSourcePath ? 2 : 1; index < argumentsValue.length; index += 1) {
    const flag = argumentsValue[index]!;
    if ((flag === "--out" || flag === "-o") && command === "compile") {
      outputPath = valueAfter(argumentsValue, index, flag);
      index += 1;
    } else if ((flag === "--out" || flag === "-o") && command === "generate") {
      outputPath = valueAfter(argumentsValue, index, flag);
      index += 1;
    } else if (flag === "--check" && command === "generate") {
      checkGenerated = true;
    } else if (flag === "--suite" && command === "test") {
      suitePath = valueAfter(argumentsValue, index, flag);
      index += 1;
    } else if (flag === "--input" && command === "run") {
      inputPath = valueAfter(argumentsValue, index, flag);
      index += 1;
    } else if (flag === "--host" && command === "run") {
      hostPath = valueAfter(argumentsValue, index, flag);
      index += 1;
    } else if (flag === "--workflow" && command === "run") {
      workflow = valueAfter(argumentsValue, index, flag);
      index += 1;
    } else {
      throw new Error(`Unknown option for ${command}: ${flag}`);
    }
  }

  if (command === "compile") {
    return {
      command,
      ...(hasSourcePath ? { sourcePath } : {}),
      ...(outputPath === undefined ? {} : { outputPath }),
    };
  }
  if (command === "generate") {
    return {
      command,
      check: checkGenerated,
      ...(hasSourcePath ? { sourcePath } : {}),
      ...(outputPath === undefined ? {} : { outputPath }),
    };
  }
  if (command === "run") {
    return {
      command,
      ...(hasSourcePath ? { sourcePath } : {}),
      ...(inputPath === undefined ? {} : { inputPath }),
      ...(hostPath === undefined ? {} : { hostPath }),
      ...(workflow === undefined ? {} : { workflow }),
    };
  }
  return {
    command: "test",
    ...(hasSourcePath ? { sourcePath } : {}),
    ...(suitePath === undefined ? {} : { suitePath }),
  };
};

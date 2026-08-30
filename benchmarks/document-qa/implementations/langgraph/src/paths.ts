import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));

export const benchmarkRoot = resolve(moduleDirectory, "../../../..");

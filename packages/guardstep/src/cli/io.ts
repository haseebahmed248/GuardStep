import { mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const readSource = (path: string): { sourcePath: string; source: string } => {
  const sourcePath = resolve(path);
  return { sourcePath, source: readFileSync(sourcePath, "utf8") };
};

export const resolveSourcePath = (providedPath: string | undefined): string => {
  if (providedPath !== undefined) return providedPath;
  const candidates = readdirSync(process.cwd(), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".guard"))
    .map((entry) => entry.name)
    .sort();
  if (candidates.length === 1) return candidates[0]!;
  if (candidates.length === 0) {
    throw new Error("No .guard file found in the current directory; provide a file path");
  }
  throw new Error(`Multiple .guard files found (${candidates.join(", ")}); provide a file path`);
};

export const writeFileAtomic = (path: string, content: string): void => {
  const target = resolve(path);
  mkdirSync(dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}`;
  try {
    writeFileSync(temporary, content, { encoding: "utf8", flag: "wx" });
    renameSync(temporary, target);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {
      // The temporary file may not have been created.
    }
    throw error;
  }
};

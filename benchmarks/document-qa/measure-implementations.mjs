import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const benchmarkRoot = fileURLToPath(new URL(".", import.meta.url));
const implementationsRoot = join(benchmarkRoot, "implementations");
const implementationNames = ["typescript", "baml", "langgraph"];
const includedExtensions = new Set([".ts", ".baml"]);
const excludedDirectories = new Set(["baml_client", "dist", "node_modules"]);

const collectFiles = (directory) => {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectFiles(path));
    if (entry.isFile() && includedExtensions.has(extname(entry.name))) files.push(path);
  }
  return files.sort();
};

const countSourceLines = (source) => {
  let inBlockComment = false;
  let count = 0;

  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    if (inBlockComment) {
      if (trimmed.includes("*/")) inBlockComment = false;
      continue;
    }
    if (trimmed.startsWith("//")) continue;
    if (trimmed.startsWith("/*")) {
      if (!trimmed.includes("*/", 2)) inBlockComment = true;
      continue;
    }
    count += 1;
  }

  return count;
};

console.log("implementation\tfiles\thandwritten_source_lines");

for (const name of implementationNames) {
  const root = join(implementationsRoot, name);
  const files = collectFiles(root);
  const total = files.reduce(
    (sum, file) => sum + countSourceLines(readFileSync(file, "utf8")),
    0,
  );
  console.log(`${name}\t${files.length}\t${total}`);

  if (process.argv.includes("--files")) {
    for (const file of files) {
      const lines = countSourceLines(readFileSync(file, "utf8"));
      console.log(`  ${relative(root, file)}\t${lines}`);
    }
  }
}

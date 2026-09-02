import { spawnSync } from "node:child_process";
import {
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = join(repositoryRoot, "packages", "guardstep");
const packageManifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";
const temporaryRoot = mkdtempSync(join(tmpdir(), "guardstep-package-"));

const fail = (message) => {
  throw new Error(message);
};

const run = (command, argumentsValue, cwd, options = {}) => {
  const result = spawnSync(command, argumentsValue, {
    cwd,
    encoding: "utf8",
    shell: options.shell ?? (process.platform === "win32" && command.endsWith(".cmd")),
    env: process.env,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    fail(`${command} ${argumentsValue.join(" ")} failed${output === "" ? "" : `:\n${output}`}`);
  }
  return result.stdout.trim();
};

const assertPackageFiles = (files) => {
  const paths = new Set(files.map((file) => file.path));
  const packageRootFiles = new Set(["LICENSE", "README.md", "package.json"]);
  const requiredPaths = [
    ...packageRootFiles,
    "dist/index.js",
    "dist/index.d.ts",
    "dist/cli/main.js",
  ];
  for (const requiredPath of requiredPaths) {
    if (!paths.has(requiredPath)) fail(`Package is missing required file: ${requiredPath}`);
  }

  const unexpectedPaths = [...paths].filter(
    (path) => !packageRootFiles.has(path) && !path.startsWith("dist/"),
  );
  if (unexpectedPaths.length > 0) {
    fail(`Package contains unexpected files:\n${unexpectedPaths.join("\n")}`);
  }
  const testPaths = [...paths].filter((path) => path.startsWith("dist/test/"));
  if (testPaths.length > 0) fail(`Package contains compiled tests:\n${testPaths.join("\n")}`);
};

const publicSpecifiers = Object.keys(packageManifest.exports).map((subpath) =>
  subpath === "." ? packageManifest.name : `${packageManifest.name}/${subpath.slice(2)}`,
);

const assertPublishMetadata = (manifest) => {
  if (Object.hasOwn(manifest, "private")) fail("Published manifest must not contain private");
  if (manifest.license !== "Apache-2.0") fail("Published manifest has the wrong license");
  if (manifest.repository?.url !== "git+https://github.com/haseebahmed248/GuardStep.git") {
    fail("Published manifest has the wrong repository URL");
  }
  if (manifest.repository?.directory !== "packages/guardstep") {
    fail("Published manifest has the wrong repository directory");
  }
  if (manifest.publishConfig?.access !== "public" || manifest.publishConfig?.tag !== "alpha") {
    fail("Published manifest must default to a public alpha release");
  }
};

try {
  const packOutput = run(
    npmExecutable,
    ["pack", "--json", "--silent", "--pack-destination", temporaryRoot, "--workspace", "guardstep"],
    repositoryRoot,
  );
  const packResult = JSON.parse(packOutput);
  if (!Array.isArray(packResult) || packResult.length !== 1) {
    fail("npm pack did not return exactly one package");
  }
  const packed = packResult[0];
  assertPackageFiles(packed.files);

  const archivePath = join(temporaryRoot, packed.filename);
  const consumerRoot = join(temporaryRoot, "consumer");
  mkdirSync(consumerRoot);
  writeFileSync(
    join(consumerRoot, "package.json"),
    `${JSON.stringify({ name: "guardstep-package-smoke-test", private: true, type: "module" }, null, 2)}\n`,
  );
  run(
    npmExecutable,
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
      archivePath,
    ],
    consumerRoot,
  );

  const installedRoot = join(consumerRoot, "node_modules", packageManifest.name);
  const installedManifestPath = join(installedRoot, "package.json");
  const installedManifestSource = readFileSync(installedManifestPath, "utf8");
  run(npmExecutable, ["pkg", "fix"], installedRoot);
  if (readFileSync(installedManifestPath, "utf8") !== installedManifestSource) {
    fail("npm pkg fix would rewrite the published manifest");
  }
  const installedManifest = JSON.parse(installedManifestSource);
  assertPublishMetadata(installedManifest);
  const installedLicense = readFileSync(join(installedRoot, "LICENSE"), "utf8");
  const repositoryLicense = readFileSync(join(repositoryRoot, "LICENSE"), "utf8");
  if (installedLicense !== repositoryLicense) {
    fail("Packaged LICENSE does not match the repository license");
  }

  const importCheckPath = join(consumerRoot, "verify-imports.mjs");
  writeFileSync(
    importCheckPath,
    `${publicSpecifiers.map((specifier) => `await import(${JSON.stringify(specifier)});`).join("\n")}\n`,
  );
  run(process.execPath, [importCheckPath], consumerRoot);

  const typeCheckPath = join(consumerRoot, "verify-types.ts");
  writeFileSync(
    typeCheckPath,
    `${publicSpecifiers
      .map(
        (specifier, index) =>
          `import * as export${index} from ${JSON.stringify(specifier)};\nvoid export${index};`,
      )
      .join("\n")}\n`,
  );
  writeFileSync(
    join(consumerRoot, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          module: "NodeNext",
          moduleResolution: "NodeNext",
          noEmit: true,
          strict: true,
          target: "ES2022",
        },
        files: ["verify-types.ts"],
      },
      null,
      2,
    )}\n`,
  );
  const typeScriptExecutable = join(
    repositoryRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "tsc.cmd" : "tsc",
  );
  run(typeScriptExecutable, ["--project", join(consumerRoot, "tsconfig.json")], consumerRoot, {
    shell: process.platform === "win32",
  });

  for (const binaryName of ["guardstep", "gs"]) {
    if (installedManifest.bin[binaryName] === undefined) {
      fail(`Missing binary declaration: ${binaryName}`);
    }
    const executablePath = join(
      consumerRoot,
      "node_modules",
      ".bin",
      process.platform === "win32" ? `${binaryName}.cmd` : binaryName,
    );
    lstatSync(executablePath);
    const output = run(executablePath, ["--version"], consumerRoot, {
      shell: process.platform === "win32",
    });
    if (output !== installedManifest.version) {
      fail(`${binaryName} reported ${JSON.stringify(output)} instead of ${installedManifest.version}`);
    }
  }

  console.log(
    `Verified ${packed.filename}: ${packed.entryCount} files, ${publicSpecifiers.length} exports, and 2 executables.`,
  );
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}

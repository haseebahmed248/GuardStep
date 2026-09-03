import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(dirname(scriptPath), "..");
const alphaVersionPattern = /^\d+\.\d+\.\d+-alpha\.\d+$/;

export function verifyReleaseContract({
  tag,
  packageVersion,
  lockVersion,
  sourceVersion,
  publishAccess,
  publishTag
}) {
  const failures = [];

  if (!alphaVersionPattern.test(packageVersion)) {
    failures.push(`package version must be an alpha version, received ${JSON.stringify(packageVersion)}`);
  }
  if (tag !== `v${packageVersion}`) {
    failures.push(`release tag ${JSON.stringify(tag)} must equal ${JSON.stringify(`v${packageVersion}`)}`);
  }
  if (lockVersion !== packageVersion) {
    failures.push(`lockfile version ${JSON.stringify(lockVersion)} must equal package version ${JSON.stringify(packageVersion)}`);
  }
  if (sourceVersion !== packageVersion) {
    failures.push(`source version ${JSON.stringify(sourceVersion)} must equal package version ${JSON.stringify(packageVersion)}`);
  }
  if (publishAccess !== "public") {
    failures.push(`publish access must be "public", received ${JSON.stringify(publishAccess)}`);
  }
  if (publishTag !== "alpha") {
    failures.push(`publish tag must be "alpha", received ${JSON.stringify(publishTag)}`);
  }

  if (failures.length > 0) {
    throw new Error(`Release contract failed:\n- ${failures.join("\n- ")}`);
  }
}

async function loadReleaseContract(tag) {
  const [packageText, lockText, sourceText] = await Promise.all([
    readFile(resolve(repositoryRoot, "packages/guardstep/package.json"), "utf8"),
    readFile(resolve(repositoryRoot, "package-lock.json"), "utf8"),
    readFile(resolve(repositoryRoot, "packages/guardstep/src/version.ts"), "utf8")
  ]);

  const packageManifest = JSON.parse(packageText);
  const lockfile = JSON.parse(lockText);
  const sourceMatch = sourceText.match(/export const GUARDSTEP_VERSION = "([^"]+)";/);

  if (!sourceMatch) {
    throw new Error("Could not read GUARDSTEP_VERSION from packages/guardstep/src/version.ts");
  }

  return {
    tag,
    packageVersion: packageManifest.version,
    lockVersion: lockfile.packages?.["packages/guardstep"]?.version,
    sourceVersion: sourceMatch[1],
    publishAccess: packageManifest.publishConfig?.access,
    publishTag: packageManifest.publishConfig?.tag
  };
}

async function main() {
  const tag = process.argv[2] ?? process.env.GUARDSTEP_RELEASE_TAG;
  if (!tag) {
    throw new Error("Usage: npm run check:release -- v<package-version>");
  }

  verifyReleaseContract(await loadReleaseContract(tag));
  console.log(`Release contract verified: ${tag}`);
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

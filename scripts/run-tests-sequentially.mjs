import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepositoryRoot = resolve(dirname(scriptPath), "..");

export const CANONICAL_TEST_FILE_NAMES = Object.freeze([
  "companion.test.mjs",
  "hardening.test.mjs",
  "plugin-structure.test.mjs",
  "process-lifecycle.test.mjs",
  "public-skill-routing.test.mjs",
  "runtime-result-contract.test.mjs",
  "skill-parity.test.mjs",
  "test-runner-contract.test.mjs"
]);

export function discoverRootTestFiles(repositoryRoot = defaultRepositoryRoot) {
  const testsDirectory = join(repositoryRoot, "tests");
  return readdirSync(testsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
    .map((entry) => join(testsDirectory, entry.name))
    .sort((left, right) => left.localeCompare(right, "en"));
}

export function runRepositoryTests(
  {
    repositoryRoot = defaultRepositoryRoot,
    execPath = process.execPath,
    spawnSyncImpl = spawnSync,
    writeLine = console.log
  } = {}
) {
  const testFiles = discoverRootTestFiles(repositoryRoot);
  let executedCount = 0;
  const discoveredNames = testFiles.map((testFile) => basename(testFile));
  const isCanonicalSet =
    discoveredNames.length > 0 &&
    discoveredNames.length === CANONICAL_TEST_FILE_NAMES.length &&
    discoveredNames.every(
      (name, index) => name === CANONICAL_TEST_FILE_NAMES[index]
    );
  if (!isCanonicalSet) {
    writeLine(`Sequential tests: discovered=${testFiles.length} executed=0`);
    writeLine("Sequential tests: canonical root test-file contract mismatch.");
    return 1;
  }

  let status = 0;
  for (const testFile of testFiles) {
    const child = spawnSyncImpl(execPath, ["--test", testFile], {
      stdio: "inherit"
    });
    executedCount += 1;
    if (child.error) {
      status = 1;
      break;
    }
    if (child.status !== 0) {
      status = Number.isInteger(child.status) ? child.status : 1;
      break;
    }
  }
  writeLine(`Sequential tests: discovered=${testFiles.length} executed=${executedCount}`);
  return status;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(scriptPath)) {
  process.exitCode = runRepositoryTests();
}

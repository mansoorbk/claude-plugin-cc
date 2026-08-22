import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import test from "node:test";

import {
  CANONICAL_TEST_FILE_NAMES,
  discoverRootTestFiles,
  runRepositoryTests
} from "../scripts/run-tests-sequentially.mjs";
import { makeTempDirectory } from "./helpers/harness.mjs";

const expectedCanonicalNames = [
  "companion.test.mjs",
  "hardening.test.mjs",
  "plugin-structure.test.mjs",
  "process-lifecycle.test.mjs",
  "public-skill-routing.test.mjs",
  "runtime-result-contract.test.mjs",
  "skill-parity.test.mjs",
  "test-runner-contract.test.mjs"
];

function createRunnerRepository(t, names = expectedCanonicalNames) {
  const root = makeTempDirectory(t, "sequential-runner-contract-");
  mkdirSync(join(root, "tests"), { recursive: true });
  for (const name of names) {
    writeFileSync(join(root, "tests", name), "export {};\n");
  }
  return root;
}

function runControlled(root, statuses = []) {
  const calls = [];
  const output = [];
  let active = false;
  const status = runRepositoryTests({
    repositoryRoot: root,
    execPath: process.execPath,
    writeLine: (line) => output.push(line),
    spawnSyncImpl(command, args, options) {
      assert.equal(active, false, "a second test launched before the first returned");
      active = true;
      calls.push({ command, args, options });
      const childStatus = statuses[calls.length - 1] ?? 0;
      active = false;
      return { status: childStatus };
    }
  });
  return { calls, output, status };
}

test("runner pins the canonical root test-file set", () => {
  assert.deepEqual(CANONICAL_TEST_FILE_NAMES, expectedCanonicalNames);
});

test("runner fails closed before launch when discovery is empty", (t) => {
  const root = createRunnerRepository(t, []);
  const result = runControlled(root);

  assert.equal(result.status, 1);
  assert.equal(result.calls.length, 0);
  assert.match(result.output.join("\n"), /discovered=0 executed=0/);
});

test("runner fails closed before launch when a canonical test is missing", (t) => {
  const root = createRunnerRepository(t, expectedCanonicalNames.slice(0, -1));
  const result = runControlled(root);

  assert.equal(result.status, 1);
  assert.equal(result.calls.length, 0);
  assert.match(result.output.join("\n"), /discovered=7 executed=0/);
});

test("runner fails closed before launch when an extra root test is present", (t) => {
  const root = createRunnerRepository(t, [
    ...expectedCanonicalNames,
    "unexpected.test.mjs"
  ]);
  const result = runControlled(root);

  assert.equal(result.status, 1);
  assert.equal(result.calls.length, 0);
  assert.match(result.output.join("\n"), /discovered=9 executed=0/);
});

test("runner launches the exact canonical set sequentially with the current Node executable", (t) => {
  const root = createRunnerRepository(t);
  const result = runControlled(root);

  assert.equal(result.status, 0);
  assert.deepEqual(
    result.calls.map(({ command, args, options }) => ({
      command,
      name: basename(args[1]),
      nodeTestFlag: args[0],
      options
    })),
    expectedCanonicalNames.map((name) => ({
      command: process.execPath,
      name,
      nodeTestFlag: "--test",
      options: { stdio: "inherit" }
    }))
  );
  assert.match(result.output.join("\n"), /discovered=8 executed=8/);
});

test("runner stops after the first failed canonical test and reports exact counts", (t) => {
  const root = createRunnerRepository(t);
  const result = runControlled(root, [0, 7, 0]);

  assert.equal(result.status, 7);
  assert.deepEqual(
    result.calls.map(({ args }) => basename(args[1])),
    expectedCanonicalNames.slice(0, 2)
  );
  assert.match(result.output.join("\n"), /discovered=8 executed=2/);
});

test("root-only discovery excludes helpers, fixtures, scratch, and review snapshots", (t) => {
  const root = createRunnerRepository(t, ["a.test.mjs", "z.test.mjs"]);
  mkdirSync(join(root, "tests", "fixtures"), { recursive: true });
  mkdirSync(join(root, "tests", "scratch"), { recursive: true });
  mkdirSync(join(root, ".superpowers", "review", "tests"), { recursive: true });
  for (const path of [
    join(root, "tests", "helpers.mjs"),
    join(root, "tests", "fixtures", "fixture.test.mjs"),
    join(root, "tests", "scratch", "scratch.test.mjs"),
    join(root, ".superpowers", "review", "tests", "snapshot.test.mjs")
  ]) {
    writeFileSync(path, "export {};\n");
  }

  assert.deepEqual(discoverRootTestFiles(root).map((path) => basename(path)), [
    "a.test.mjs",
    "z.test.mjs"
  ]);
});

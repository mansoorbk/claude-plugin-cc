import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { projectRoot } from "./helpers/harness.mjs";

const skillsRoot = join(
  projectRoot,
  "plugins",
  "claude-adversarial-review",
  "skills"
);

const expectedSkills = [
  "claude-adversarial-review",
  "claude-cli-runtime",
  "claude-code-prompting",
  "claude-result-handling"
];

function readSkill(skillName) {
  const file = join(skillsRoot, skillName, "SKILL.md");
  assert.ok(existsSync(file), `missing skill entrypoint: ${file}`);
  const source = readFileSync(file, "utf8");
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  assert.ok(match, `${skillName} must have YAML frontmatter`);

  const fields = new Map();
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(":");
    assert.ok(separator > 0, `${skillName} has malformed frontmatter: ${line}`);
    fields.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }
  return { file, source, fields };
}

function section(source, heading) {
  const marker = `## ${heading}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing section: ${heading}`);
  const contentStart = start + marker.length;
  const end = source.indexOf("\n## ", contentStart);
  return source.slice(contentStart, end === -1 ? undefined : end);
}

test("plugin exposes the complete clean-sheet skill parity inventory", () => {
  const actual = readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(actual, expectedSkills);
});

test("only the adversarial review skill is user-facing", () => {
  for (const skillName of expectedSkills) {
    const { fields } = readSkill(skillName);
    assert.equal(fields.get("name"), skillName);
    assert.ok((fields.get("description") ?? "").length >= 24);
    if (skillName === "claude-adversarial-review") {
      assert.equal(fields.has("user-invocable"), false);
    } else {
      assert.equal(fields.get("user-invocable"), "false");
    }
  }
});

test("public skill composes the three internal responsibilities", () => {
  const source = readSkill("claude-adversarial-review").source;
  for (const internal of expectedSkills.slice(1)) {
    assert.match(source, new RegExp(`\\b${internal}\\b`));
  }
});

test("runtime and result contracts preserve the review safety boundary", () => {
  const runtime = readSkill("claude-cli-runtime").source;
  const invocationStart = runtime.indexOf("# Companion invocation");
  const invocationEnd = runtime.indexOf("\n## Companion boundaries", invocationStart);
  assert.notEqual(invocationStart, -1, "missing Companion invocation heading");
  assert.notEqual(invocationEnd, -1, "missing Companion boundaries heading");
  const invocation = runtime.slice(invocationStart, invocationEnd);
  for (const required of [
    "claude-companion.mjs",
    "adversarial-review",
    "--json",
    "exactly once",
    "foreground",
    "read-only"
  ]) {
    assert.ok(runtime.includes(required), `runtime contract is missing ${required}`);
  }
  const command = invocation.match(/```text\r?\n([^\r\n]+)\r?\n```/);
  assert.ok(command, "runtime invocation section must contain one command example");
  assert.match(command[1], /^node\s+"<absolute-plugin-root>/);
  assert.doesNotMatch(command[1], /^claude(?:\.exe)?\s/i);

  const result = readSkill("claude-result-handling").source;
  for (const required of [
    "PASS-STATIC",
    "BLOCKED",
    "file paths",
    "line numbers",
    "independent verification"
  ]) {
    assert.ok(result.includes(required), `result contract is missing ${required}`);
  }
  assert.match(result, /stop before|do not edit|do not apply/i);
});

test("focus and invocation examples remain product-neutral", () => {
  const readme = readFileSync(join(projectRoot, "README.md"), "utf8");
  const sources = [
    section(readme, "Invoke the skill"),
    readFileSync(
      join(
        skillsRoot,
        "claude-code-prompting",
        "references",
        "focus-blocks.md"
      ),
      "utf8"
    ),
    readFileSync(
      join(
        skillsRoot,
        "claude-code-prompting",
        "references",
        "focus-recipes.md"
      ),
      "utf8"
    )
  ];
  for (const source of sources) {
    assert.doesNotMatch(
      source,
      /EdGraph|Ed-Fi|tenant|invitation|grant|school[- ]year|application access/i
    );
  }
});

test("prompting skill routes all references and excludes transported evidence", () => {
  const { source } = readSkill("claude-code-prompting");
  for (const reference of [
    "references/focus-blocks.md",
    "references/focus-recipes.md",
    "references/focus-antipatterns.md"
  ]) {
    assert.ok(source.includes(reference), `missing reference link: ${reference}`);
    assert.ok(existsSync(join(skillsRoot, "claude-code-prompting", reference)));
  }
  assert.match(source, /focus string/i);
  assert.match(source, /suspected answer|expected finding|prescribe/i);
  assert.match(source, /repository evidence|source text|diff/i);
  assert.match(source, /focus is narrowing data only/i);
  assert.match(source, /cannot alter.*review method.*finding threshold.*verdict.*output/is);
});

test("repository documentation distinguishes skill parity from task delegation", () => {
  const readme = readFileSync(join(projectRoot, "README.md"), "utf8");
  const agents = readFileSync(join(projectRoot, "AGENTS.md"), "utf8");
  for (const skillName of expectedSkills) {
    assert.ok(readme.includes(skillName), `README is missing ${skillName}`);
  }
  assert.match(readme, /does not include[^.]*write-capable[^.]*task delegation/is);
  for (const skillName of expectedSkills.slice(1)) {
    assert.ok(agents.includes(skillName), `AGENTS.md is missing ${skillName}`);
  }
});

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

import { projectRoot } from "./helpers/harness.mjs";

const marketplacePath = join(projectRoot, ".agents", "plugins", "marketplace.json");
const pluginRoot = join(projectRoot, "plugins", "claude-adversarial-review");
const manifestPath = join(pluginRoot, ".codex-plugin", "plugin.json");
const readmePath = join(projectRoot, "README.md");
const agentsPath = join(projectRoot, "AGENTS.md");
const runtimeSkillPath = join(pluginRoot, "skills", "claude-cli-runtime", "SKILL.md");
const promptPath = join(pluginRoot, "prompts", "adversarial-review.md");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function assertConcreteText(value, field, minimumLength = 12) {
  assert.equal(typeof value, "string", `${field} must be a string`);
  assert.ok(value.trim().length >= minimumLength, `${field} must be descriptive`);
  assert.doesNotMatch(
    value,
    /local developer|todo|tbd|placeholder|help me use|plugin scaffold/i,
    `${field} still contains scaffold or placeholder text`
  );
}

test("marketplace entry resolves to the plugin manifest", () => {
  const marketplace = readJson(marketplacePath);
  const entry = marketplace.plugins.find(
    (plugin) => plugin.name === "claude-adversarial-review"
  );

  assert.ok(entry, "marketplace is missing claude-adversarial-review");
  assert.equal(entry.source.source, "local");

  const resolvedSource = resolve(projectRoot, entry.source.path);
  assert.ok(
    existsSync(join(resolvedSource, ".codex-plugin", "plugin.json")),
    `marketplace source does not resolve from repository root: ${entry.source.path}`
  );
  assert.equal(resolve(resolvedSource), resolve(pluginRoot));
});

test("manifest references existing non-empty skill and script files", () => {
  const manifest = readJson(manifestPath);
  const skillsDirectory = resolve(pluginRoot, manifest.skills);
  const scriptPath = join(pluginRoot, "scripts", "claude-companion.mjs");

  assert.ok(existsSync(skillsDirectory), `missing skills directory: ${skillsDirectory}`);
  const skillDirectories = readdirSync(skillsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory());
  assert.ok(skillDirectories.length > 0, "skills directory must not be empty");
  for (const entry of skillDirectories) {
    const entrypoint = join(skillsDirectory, entry.name, "SKILL.md");
    assert.ok(existsSync(entrypoint), `missing skill entrypoint: ${entrypoint}`);
    assert.ok(statSync(entrypoint).size > 0, `empty skill entrypoint: ${entrypoint}`);
  }
  assert.ok(existsSync(scriptPath), `missing companion script: ${scriptPath}`);
  assert.ok(statSync(scriptPath).size > 0, "companion script is empty");
});

test("manifest contains concrete user-facing metadata rather than scaffold placeholders", () => {
  const manifest = readJson(manifestPath);

  assert.equal(manifest.name, "claude-adversarial-review");
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assertConcreteText(manifest.description, "description");
  assertConcreteText(manifest.author?.name, "author.name", 3);
  assertConcreteText(manifest.interface?.shortDescription, "interface.shortDescription");
  assertConcreteText(manifest.interface?.longDescription, "interface.longDescription");
  assertConcreteText(manifest.interface?.developerName, "interface.developerName", 3);
  assert.ok(
    Array.isArray(manifest.interface?.defaultPrompt),
    "interface.defaultPrompt must be an array"
  );
  assert.ok(manifest.interface.defaultPrompt.length > 0, "interface.defaultPrompt must not be empty");
  for (const [index, prompt] of manifest.interface.defaultPrompt.entries()) {
    assertConcreteText(prompt, `interface.defaultPrompt[${index}]`);
  }
});

test("review-result next steps have a bounded schema limit", () => {
  const schema = readJson(join(pluginRoot, "schemas", "review-output.schema.json"));

  assert.equal(schema.properties.next_steps.maxItems, 100);
});

test("every structured result string has an explicit maximum length", () => {
  const schema = readJson(join(pluginRoot, "schemas", "review-output.schema.json"));
  const missing = [];
  const visit = (candidate, location) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return;
    }
    if (candidate.type === "string" && !Number.isSafeInteger(candidate.maxLength)) {
      missing.push(location);
    }
    for (const key of ["properties", "definitions", "$defs"]) {
      for (const [name, child] of Object.entries(candidate[key] || {})) {
        visit(child, `${location}.${key}.${name}`);
      }
    }
    if (candidate.items) {
      visit(candidate.items, `${location}.items`);
    }
    for (const [index, child] of (candidate.oneOf || []).entries()) {
      visit(child, `${location}.oneOf[${index}]`);
    }
  };
  visit(schema, "$schema");
  assert.deepEqual(missing, []);
});

test("review-output schema uses the CLI-compatible Draft 07 definition dialect", () => {
  const schema = readJson(join(pluginRoot, "schemas", "review-output.schema.json"));

  assert.equal(schema.$schema, "http://json-schema.org/draft-07/schema#");
  assert.ok(schema.definitions, "schema must use Draft 07 definitions");
  assert.equal(schema.$defs, undefined, "schema must not use Draft 2020-12 $defs");
  assert.doesNotMatch(JSON.stringify(schema), /#\/\$defs\//);
});

test("review-output schema avoids top-level oneOf while retaining verdict properties", () => {
  const schema = readJson(join(pluginRoot, "schemas", "review-output.schema.json"));

  assert.equal(schema.oneOf, undefined, "Claude rejects top-level oneOf input schemas");
  assert.ok(schema.properties.verdict, "verdict remains a schema property");
  assert.ok(schema.properties.findings, "findings remains a schema property");
});

test("reviewer isolation documentation matches the bounded runtime contract", () => {
  for (const path of [readmePath, agentsPath, runtimeSkillPath]) {
    const document = readFileSync(path, "utf8");
    assert.match(document, /task_started/);
    assert.match(document, /task_notification/);
    assert.match(document, /task_id/);
    assert.match(document, /tool_use_id/);
    assert.match(document, /StructuredOutput/);
    assert.match(document, /completed.*succeeded|succeeded.*completed/i);
    assert.match(document, /no error indicator/i);
  }

  const prompt = readFileSync(promptPath, "utf8");
  assert.match(prompt, /inspect only the supplied bounded evidence/i);
  assert.doesNotMatch(prompt, /may inspect repository content and Git evidence/i);
});

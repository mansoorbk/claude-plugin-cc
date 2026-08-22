import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { projectRoot } from "./helpers/harness.mjs";

const publicSkill = readFileSync(
  join(
    projectRoot,
    "plugins",
    "claude-adversarial-review",
    "skills",
    "claude-adversarial-review",
    "SKILL.md"
  ),
  "utf8"
);
const internalSkills = new Map(
  ["claude-code-prompting", "claude-cli-runtime", "claude-result-handling"].map(
    (name) => [
      name,
      readFileSync(
        join(
          projectRoot,
          "plugins",
          "claude-adversarial-review",
          "skills",
          name,
          "SKILL.md"
        ),
        "utf8"
      )
    ]
  )
);

function section(source, heading) {
  const marker = `## ${heading}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing section: ${heading}`);
  const contentStart = start + marker.length;
  const end = source.indexOf("\n## ", contentStart);
  return source.slice(contentStart, end === -1 ? undefined : end);
}

test("public skill delegates internal contracts without reproducing them", () => {
  const routing = section(publicSkill, "Internal workflow routing");
  for (const internalSkill of [
    "claude-code-prompting",
    "claude-cli-runtime",
    "claude-result-handling"
  ]) {
    assert.match(routing, new RegExp(`\\b${internalSkill}\\b`));
  }

  assert.equal(
    (routing.match(/`claude-result-handling`/g) ?? []).length,
    1,
    "the public skill should delegate result presentation in one line"
  );

  for (const resultOwnedConcept of [
    /PASS-STATIC/i,
    /BLOCKED/i,
    /MATERIAL_FINDINGS/i,
    /NO_MATERIAL_FINDINGS_STATIC/i,
    /exact transported(?:-line|-evidence) grounding/i,
    /deleted line.*transported/i,
    /stop before edits/i,
    /do not edit files or apply recommendations/i
  ]) {
    assert.doesNotMatch(publicSkill, resultOwnedConcept);
  }

  assert.doesNotMatch(publicSkill, /claude-companion\.mjs/i);
  assert.doesNotMatch(publicSkill, /^node\s+.*adversarial-review\s+--json/m);
});

test("internal implementation concepts appear only in their owning skills", () => {
  const sources = new Map([
    ["claude-adversarial-review", publicSkill],
    ...internalSkills
  ]);
  const ownership = new Map([
    ["claude-code-prompting", [
      /references\/focus-blocks\.md/i,
      /references\/focus-recipes\.md/i,
      /references\/focus-antipatterns\.md/i
    ]],
    ["claude-cli-runtime", [
      /claude-companion\.mjs/i,
      /NO_REVIEWABLE_EVIDENCE/,
      /PROCESS_CLEANUP_FAILED/,
      /task_started/
    ]],
    ["claude-result-handling", [
      /PASS-STATIC/,
      /MATERIAL_FINDINGS/,
      /NO_MATERIAL_FINDINGS_STATIC/,
      /exact transported-line grounding/i,
      /Stop before edits/i
    ]]
  ]);

  for (const [owner, concepts] of ownership) {
    for (const concept of concepts) {
      assert.match(sources.get(owner), concept, `${owner} does not own ${concept}`);
      for (const [name, source] of sources) {
        if (name !== owner) {
          assert.doesNotMatch(source, concept, `${concept} leaked from ${owner} into ${name}`);
        }
      }
    }
  }
});

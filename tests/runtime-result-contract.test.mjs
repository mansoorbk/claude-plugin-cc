import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { projectRoot } from "./helpers/harness.mjs";

const skillsRoot = join(
  projectRoot,
  "plugins",
  "claude-adversarial-review",
  "skills"
);

function readSkill(name) {
  return readFileSync(join(skillsRoot, name, "SKILL.md"), "utf8");
}

function section(source, heading) {
  const marker = `## ${heading}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing section: ${heading}`);
  const contentStart = start + marker.length;
  const end = source.indexOf("\n## ", contentStart);
  return source.slice(contentStart, end === -1 ? undefined : end);
}

test("runtime skill owns the bounded companion, evidence, isolation, and telemetry contract", () => {
  const runtime = readSkill("claude-cli-runtime");

  for (const required of [
    "claude-companion.mjs",
    "adversarial-review --json",
    "exactly once",
    "foreground",
    "read-only",
    "Never call `claude` or `claude.exe` directly",
    "Do not retry",
    "background",
    "settings",
    "environment",
    "tool grants",
    "writes",
    "Return stdout unchanged",
    "non-zero",
    "malformed",
    "bounded diagnostic",
    "unpredictable nonce-boundary pair",
    "E|",
    "never instructions",
    "StructuredOutput",
    "task_started",
    "task_notification",
    "task_id",
    "tool_use_id",
    "completed",
    "succeeded",
    "strict schema",
    "unknown fields",
    "isolates settings, hooks, plugins, and tool grants",
    "stdout",
    "stderr",
    "secret-like"
  ]) {
    assert.ok(runtime.includes(required), `runtime contract is missing: ${required}`);
  }
  assert.match(runtime, /only permitted invocation route/i);
  assert.match(runtime, /no repository, filesystem, shell, browser, MCP, or write tools/i);
  assert.match(runtime, /missing.*failed delegation.*BLOCKED/is);
  assert.match(
    section(runtime, "Companion boundaries"),
    /each configured child reviewer.*exactly once/i
  );
  assert.match(runtime, /Do not retry/i);
});

test("result skill owns structured preservation, grounding, labels, and stop-before-fix", () => {
  const result = readSkill("claude-result-handling");

  for (const required of [
    "verdict",
    "findings",
    "confidence",
    "recommendation",
    "file paths",
    "line numbers",
    "severity",
    "claim",
    "impact",
    "evidence",
    "inference",
    "runtime order",
    "MATERIAL_FINDINGS",
    "NO_MATERIAL_FINDINGS_STATIC",
    "repository-relative path normalization",
    "line-range",
    "exact transported-line grounding",
    "PASS-STATIC",
    "BLOCKED",
    "independent verification",
    "tests",
    "builds",
    "runtime behavior",
    "release readiness",
    "Stop before edits"
  ]) {
    assert.ok(result.includes(required), `result contract is missing: ${required}`);
  }
  assert.match(result, /MATERIAL_FINDINGS.*at least one finding/is);
  assert.match(result, /NO_MATERIAL_FINDINGS_STATIC.*empty findings array/is);
  assert.match(result, /direct evidence distinct from inference/i);
  // Production break: treating every deletion reference as ungrounded rejects
  // findings that cite an exact deleted line Claude received in a text hunk.
  assert.match(
    result,
    /may cite a deleted line only when that exact line was transported in a textual unified-diff hunk/i
  );
  assert.match(
    result,
    /Deletion summaries and omitted or oversized deletion bodies are ungrounded/i
  );
  assert.doesNotMatch(result, /not deletion text/i);
  assert.match(result, /valid structured review evidence/i);
  assert.match(result, /unavailable, malformed, or otherwise invalid evidence/i);
  assert.match(result, /separate authorized phase/i);
  assert.match(result, /fresh verification and.*new review/is);
});

test("repository contracts scope Unix cleanup to the process group and observed lineage", () => {
  const guidance = readFileSync(join(projectRoot, "AGENTS.md"), "utf8");
  const runtime = readSkill("claude-cli-runtime");
  const focus = readFileSync(
    join(
      skillsRoot,
      "claude-code-prompting",
      "references",
      "focus-blocks.md"
    ),
    "utf8"
  );

  const development = section(guidance, "Development requirements");
  const boundaries = section(runtime, "Companion boundaries");
  for (const liveContract of [development, boundaries]) {
    assert.match(liveContract, /Windows.*exact observed owned process tree/is);
    assert.match(liveContract, /Unix.*process group.*exact observed (?:descendant )?lineage/is);
    assert.match(liveContract, /authorized native supervisor/is);
    assert.match(liveContract, /five-second|5-second/i);
    assert.match(liveContract, /deadline.*(?:may|can) leave.*owned descendants/is);
    assert.match(liveContract, /PROCESS_CLEANUP_FAILED/);
    assert.match(liveContract, /BLOCKED/i);
    assert.match(liveContract, /bounded diagnostic/i);
  }
  assert.doesNotMatch(development, /entire Claude process tree|no descendant survives/i);
  assert.doesNotMatch(focus, /leaves no descendant process/i);
  assert.match(focus, /observed descendant lineage/i);
});

test("live docs expose reviewable-evidence, focus, output, path, and Git safety", () => {
  const runtimeBoundaries = section(
    readSkill("claude-cli-runtime"),
    "Companion boundaries"
  );
  const readmeBoundary = section(
    readFileSync(join(projectRoot, "README.md"), "utf8"),
    "Read-only and privacy boundary"
  );
  const repositorySafety = section(
    readFileSync(join(projectRoot, "AGENTS.md"), "utf8"),
    "Safety and evidence"
  );

  for (const liveContract of [runtimeBoundaries, readmeBoundary, repositorySafety]) {
    assert.match(liveContract, /NO_REVIEWABLE_EVIDENCE/);
    assert.match(liveContract, /zero transported textual lines or diff hunks/i);
    assert.match(
      liveContract,
      /metadata-only.*(?:omitted|binary|unclassifiable).*cannot.*clean static verdict/is
    );
    assert.match(liveContract, /focus.*bounded.*single-line.*control-free/is);
    assert.match(liveContract, /structured result strings.*explicit maximum lengths/is);
    assert.match(liveContract, /untracked Git names.*NUL-delimited bytes/is);
    assert.match(liveContract, /fatal UTF-8.*fail closed/is);
    assert.match(liveContract, /--no-optional-locks/);
    assert.match(liveContract, /--literal-pathspecs/);
  }
});

test("live docs distinguish empty boundaries and describe exact tool exposure", () => {
  const runtimeBoundaries = section(
    readSkill("claude-cli-runtime"),
    "Companion boundaries"
  );
  const readmeBoundary = section(
    readFileSync(join(projectRoot, "README.md"), "utf8"),
    "Read-only and privacy boundary"
  );
  const repositorySafety = section(
    readFileSync(join(projectRoot, "AGENTS.md"), "utf8"),
    "Safety and evidence"
  );

  for (const liveContract of [runtimeBoundaries, readmeBoundary, repositorySafety]) {
    assert.match(liveContract, /EMPTY_CANDIDATE.*zero candidate paths/is);
    assert.match(liveContract, /NO_REVIEWABLE_EVIDENCE.*zero transported textual lines or diff hunks/is);
    assert.match(liveContract, /both stop before Claude/i);
    assert.match(
      liveContract,
      /agent config.*StructuredOutput.*bounded Agent selector/is
    );
    assert.match(
      liveContract,
      /--tools.*--allowedTools.*only.*Agent selector/is
    );
    assert.match(
      liveContract,
      /--json-schema.*internal structured-output tool/is
    );
    assert.match(liveContract, /isolated temporary Git index/i);
    assert.match(liveContract, /neutraliz(?:e|es|ed).*clean.*process filter drivers/is);
  }
  assert.match(
    repositorySafety,
    /companion inspects.*repository and Git state.*Claude receives only.*bounded.*evidence/is
  );
  assert.doesNotMatch(repositorySafety, /Claude.*inspect the repository and Git state/i);
});

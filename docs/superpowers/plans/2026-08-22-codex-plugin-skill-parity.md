# Claude Skill Responsibility Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add clean-sheet Claude-side counterparts for all three skill responsibilities in `codex-plugin-cc` while keeping `claude-adversarial-review` as the only public, foreground, read-only workflow.

**Architecture:** The public review skill remains the orchestrator and delegates three instruction-level concerns to small internal skills: companion invocation, structured result handling, and Claude-specific focus composition. The runtime remains unchanged because it already implements the only authorized operation; parity is enforced through structural tests, skill validation, isolated behavioral forward-tests, and installed source/cache verification.

**Tech Stack:** Markdown Codex skills, Node.js 18.18+ built-in test runner, existing ESM test harness, JSON plugin manifests, PowerShell validation on Windows.

**Spec:** `docs/superpowers/specs/2026-08-22-codex-plugin-skill-parity-design.md`

## Global Constraints

- Treat `D:\workspace\edwire-saas\codex-plugin-cc` as a behavioral reference only; do not import, vendor, or copy its implementation or prose.
- Keep plugin files under `plugins/claude-adversarial-review/` and marketplace metadata under `.agents/plugins/`.
- Preserve Node.js `>=18.18` support.
- Keep Claude execution foreground, read-only, settings-isolated, bounded, and routed only through the bundled companion.
- Keep `claude-adversarial-review` as the only user-facing skill; mark the three counterparts `user-invocable: false`.
- Do not add generic task delegation, writes, background jobs, resume/status/result/cancel flows, model flags, or effort flags.
- Use synthetic sentinels only; never persist credentials, personal data, live prompts, or live review output.
- Treat Claude findings as evidence requiring independent adjudication; never auto-apply them.

---

## File Structure

- Create `tests/skill-parity.test.mjs`: exact skill inventory, frontmatter, linkage, safety-boundary, reference reachability, and prohibited-scope tests.
- Modify `tests/plugin-structure.test.mjs`: make manifest validation enumerate every skill directory instead of checking one hard-coded skill.
- Modify `package.json`: include the parity suite in `npm run validate` while retaining the full `npm test` command.
- Create `plugins/claude-adversarial-review/skills/claude-cli-runtime/SKILL.md`: internal one-call companion contract.
- Create `plugins/claude-adversarial-review/skills/claude-result-handling/SKILL.md`: internal structured-output and stop-before-fix contract.
- Create `plugins/claude-adversarial-review/skills/claude-code-prompting/SKILL.md`: internal review-focus composition router.
- Create `plugins/claude-adversarial-review/skills/claude-code-prompting/references/focus-blocks.md`: compact Claude review-focus components.
- Create `plugins/claude-adversarial-review/skills/claude-code-prompting/references/focus-recipes.md`: end-to-end examples for correctness, security, concurrency, and regression lenses.
- Create `plugins/claude-adversarial-review/skills/claude-code-prompting/references/focus-antipatterns.md`: answer-prescribing, evidence-embedding, and scope-broadening failures.
- Modify `plugins/claude-adversarial-review/skills/claude-adversarial-review/SKILL.md`: route to the three internal skills without duplicating their detailed contracts.
- Modify `README.md`: publish the four-skill inventory and distinguish skill-responsibility parity from full `codex-plugin-cc` command parity.
- Modify `AGENTS.md`: record the internal-skill ownership boundaries for future maintainers.

### Task 1: Lock the parity inventory with failing tests

**Files:**
- Create: `tests/skill-parity.test.mjs`
- Modify: `tests/plugin-structure.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: plugin root `plugins/claude-adversarial-review` and its existing `skills` manifest field.
- Produces: `readSkillFrontmatter(path) -> { name: string, description: string, userInvocable: boolean | undefined }` inside the test file and an exact expected skill-name set.

- [ ] **Step 1: Write the failing exact-inventory test**

Create `tests/skill-parity.test.mjs` with Node built-ins only. Parse the first YAML fence line-by-line; do not add a YAML dependency.

```js
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

function readSkillFrontmatter(skillName) {
  const file = join(skillsRoot, skillName, "SKILL.md");
  assert.ok(existsSync(file), `missing ${file}`);
  const source = readFileSync(file, "utf8");
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  assert.ok(match, `${skillName} must have YAML frontmatter`);
  const fields = new Map(
    match[1].split(/\r?\n/).map((line) => {
      const separator = line.indexOf(":");
      return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
    })
  );
  return { source, fields };
}

test("plugin exposes the complete clean-sheet skill parity inventory", () => {
  const actual = readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(actual, expectedSkills);
});
```

- [ ] **Step 2: Add failing internal/public policy and linkage tests**

Append tests that require `name` to equal the directory, require a discriminating description, require `user-invocable: false` on the three internal skills, prohibit that field on the public skill, and require the public skill to name each internal skill. Test structural contracts, not exact prose.

```js
test("only the adversarial review skill is user-facing", () => {
  for (const skillName of expectedSkills) {
    const { fields } = readSkillFrontmatter(skillName);
    assert.equal(fields.get("name"), skillName);
    assert.ok((fields.get("description") ?? "").length >= 24);
    if (skillName === "claude-adversarial-review") {
      assert.equal(fields.has("user-invocable"), false);
    } else {
      assert.equal(fields.get("user-invocable"), "false");
    }
  }
});

test("public skill routes each internal responsibility explicitly", () => {
  const { source } = readSkillFrontmatter("claude-adversarial-review");
  for (const internal of expectedSkills.slice(1)) {
    assert.match(source, new RegExp(`\\b${internal}\\b`));
  }
});
```

- [ ] **Step 3: Generalize the manifest structure test**

Replace the single hard-coded skill assertion in `tests/plugin-structure.test.mjs` with enumeration of every direct child directory under the manifest's resolved skills directory. Assert that each contains a non-empty `SKILL.md`; retain the existing companion-script assertion.

```js
const skillDirectories = readdirSync(skillsDirectory, { withFileTypes: true })
  .filter((entry) => entry.isDirectory());
assert.ok(skillDirectories.length > 0, "skills directory must not be empty");
for (const entry of skillDirectories) {
  const entrypoint = join(skillsDirectory, entry.name, "SKILL.md");
  assert.ok(existsSync(entrypoint), `missing skill entrypoint: ${entrypoint}`);
  assert.ok(statSync(entrypoint).size > 0, `empty skill entrypoint: ${entrypoint}`);
}
```

- [ ] **Step 4: Add the parity suite to validation**

Change only the `validate` script in `package.json`:

```json
"validate": "node --test tests/plugin-structure.test.mjs tests/skill-parity.test.mjs"
```

- [ ] **Step 5: Run the new tests and verify the expected RED state**

Run:

```powershell
npm run validate
```

Expected: FAIL because `claude-cli-runtime`, `claude-code-prompting`, and `claude-result-handling` do not exist. Confirm existing structural tests still execute; do not accept a syntax/import failure as the intended red test.

- [ ] **Step 6: Commit the red tests**

```powershell
git add tests/skill-parity.test.mjs tests/plugin-structure.test.mjs package.json
git commit -m "test: define Claude skill parity contract"
```

If the repository still has no initial commit, create the initial commit only when the user authorizes repository history creation; otherwise record the commit step as blocked and continue without fabricating commit evidence.

### Task 2: Add the internal runtime and result-handling skills

**Files:**
- Create: `plugins/claude-adversarial-review/skills/claude-cli-runtime/SKILL.md`
- Create: `plugins/claude-adversarial-review/skills/claude-result-handling/SKILL.md`
- Test: `tests/skill-parity.test.mjs`

**Interfaces:**
- Consumes: verified cwd/base/focus from `claude-adversarial-review` and JSON stdout from `scripts/claude-companion.mjs`.
- Produces: one exact companion invocation contract and one evidence-preserving presentation contract.

- [ ] **Step 1: Add failing safety-contract tests**

Add semantic invariant tests that require the runtime skill to name `claude-companion.mjs`, `adversarial-review`, `--json`, foreground execution, exactly one invocation, and no direct Claude CLI call; require result handling to name `PASS-STATIC`, `BLOCKED`, stop-before-fix behavior, line preservation, and independent verification.

```js
test("runtime and result skills preserve the review safety boundary", () => {
  const runtime = readSkillFrontmatter("claude-cli-runtime").source;
  assert.match(runtime, /claude-companion\.mjs/);
  assert.match(runtime, /adversarial-review/);
  assert.match(runtime, /--json/);
  assert.match(runtime, /exactly once/i);
  assert.match(runtime, /foreground/i);
  assert.match(runtime, /never call [`']?claude/i);

  const result = readSkillFrontmatter("claude-result-handling").source;
  assert.match(result, /PASS-STATIC/);
  assert.match(result, /BLOCKED/);
  assert.match(result, /file paths.*line numbers|line numbers.*file paths/is);
  assert.match(result, /do not (edit|apply)|stop before/i);
  assert.match(result, /independent.*verif/i);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
node --test tests/skill-parity.test.mjs
```

Expected: FAIL on the missing runtime and result skill entrypoints.

- [ ] **Step 3: Write `claude-cli-runtime/SKILL.md`**

Use this frontmatter and keep the body narrowly scoped to the existing companion:

```yaml
---
name: claude-cli-runtime
description: Internal invocation contract for one foreground, read-only Claude adversarial review through the bundled companion runtime.
user-invocable: false
---
```

The body must define these executable rules:

- consume an already-verified absolute Git cwd, base boundary, and optional focus;
- resolve the installed plugin root and invoke `node "<absolute-plugin-root>/scripts/claude-companion.mjs" adversarial-review --json [--base <ref>] [focus]` exactly once from that cwd;
- never invoke `claude`, wrappers, or fallback routes directly;
- never add unapproved environment overrides, tool grants, background execution, retries, or writes;
- return stdout unchanged; return the bounded diagnostic on failure and stop.

- [ ] **Step 4: Write `claude-result-handling/SKILL.md`**

Use this frontmatter:

```yaml
---
name: claude-result-handling
description: Internal guidance for preserving Claude adversarial-review evidence, verification labels, and the stop-before-fix boundary.
user-invocable: false
---
```

Require findings first in runtime order, exact file paths/line numbers, preserved inference/confidence distinctions, `PASS-STATIC` only for valid structured review output, `BLOCKED` for unavailable/invalid evidence, and a brief residual-risk statement. Require the caller to stop before edits and independently verify material findings in a separately authorized phase.

- [ ] **Step 5: Run the focused tests and validators**

Run:

```powershell
node --test tests/skill-parity.test.mjs
python "C:\Users\mbk\.codex\skills\.system\skill-creator\scripts\quick_validate.py" "plugins\claude-adversarial-review\skills\claude-cli-runtime"
python "C:\Users\mbk\.codex\skills\.system\skill-creator\scripts\quick_validate.py" "plugins\claude-adversarial-review\skills\claude-result-handling"
```

Expected: the focused tests may still fail only for the missing prompting skill; both validators PASS.

- [ ] **Step 6: Commit the two internal contracts**

```powershell
git add plugins/claude-adversarial-review/skills/claude-cli-runtime plugins/claude-adversarial-review/skills/claude-result-handling tests/skill-parity.test.mjs
git commit -m "feat: add Claude runtime and result skills"
```

Apply the same no-HEAD authorization boundary from Task 1.

### Task 3: Add Claude-specific focus composition guidance

**Files:**
- Create: `plugins/claude-adversarial-review/skills/claude-code-prompting/SKILL.md`
- Create: `plugins/claude-adversarial-review/skills/claude-code-prompting/references/focus-blocks.md`
- Create: `plugins/claude-adversarial-review/skills/claude-code-prompting/references/focus-recipes.md`
- Create: `plugins/claude-adversarial-review/skills/claude-code-prompting/references/focus-antipatterns.md`
- Test: `tests/skill-parity.test.mjs`

**Interfaces:**
- Consumes: a user's requested adversarial-review concern and scope.
- Produces: either no focus text or one compact focus string passed as the companion's trailing argument; never produces repository evidence or Claude CLI flags.

- [ ] **Step 1: Add failing prompting-boundary tests**

```js
test("prompting skill routes reachable references and cannot prescribe findings", () => {
  const { source } = readSkillFrontmatter("claude-code-prompting");
  for (const reference of [
    "references/focus-blocks.md",
    "references/focus-recipes.md",
    "references/focus-antipatterns.md"
  ]) {
    assert.match(source, new RegExp(reference.replace(".", "\\.")));
    assert.ok(existsSync(join(skillsRoot, "claude-code-prompting", reference)));
  }
  assert.match(source, /focus string/i);
  assert.match(source, /do not.*(prescribe|expected finding|suspected answer)/is);
  assert.match(source, /do not.*(diff|repository evidence|source text)/is);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
node --test tests/skill-parity.test.mjs
```

Expected: FAIL because `claude-code-prompting` and its references are absent.

- [ ] **Step 3: Write the prompting entrypoint**

Use this frontmatter:

```yaml
---
name: claude-code-prompting
description: Internal guidance for turning a review request into an unbiased, bounded focus string for the Claude adversarial-review companion.
user-invocable: false
---
```

Keep `SKILL.md` short. Define when no focus is needed, how to include subsystem/concern/risk lens, and when to read each reference. State that the fixed runtime prompt owns evidence framing, schema, agents, and tool restrictions; this skill must not rebuild or override them.

- [ ] **Step 4: Write the three clean-sheet references**

Use Claude-review-specific content:

- `focus-blocks.md`: optional `scope`, `risk lens`, and `invariant` components, each one sentence and without XML requirements copied from the reference.
- `focus-recipes.md`: four concise focus examples: correctness/regression, authorization boundary, concurrency/retry, and process cleanup. Each example asks Claude to challenge behavior, not confirm a suspected defect.
- `focus-antipatterns.md`: prohibit expected-answer prompts, pasted diffs/source, secrets, broad “review everything” scope, edit instructions, model/tool flags, and multiple unrelated jobs.

- [ ] **Step 5: Run tests and validate the skill**

Run:

```powershell
node --test tests/skill-parity.test.mjs
python "C:\Users\mbk\.codex\skills\.system\skill-creator\scripts\quick_validate.py" "plugins\claude-adversarial-review\skills\claude-code-prompting"
```

Expected: prompting tests and validator PASS; the inventory test may still fail until the public skill is wired.

- [ ] **Step 6: Commit the prompting skill**

```powershell
git add plugins/claude-adversarial-review/skills/claude-code-prompting tests/skill-parity.test.mjs
git commit -m "feat: add Claude review focus guidance"
```

Apply the same no-HEAD authorization boundary from Task 1.

### Task 4: Wire the public skill and document the parity boundary

**Files:**
- Modify: `plugins/claude-adversarial-review/skills/claude-adversarial-review/SKILL.md`
- Modify: `README.md`
- Modify: `AGENTS.md`
- Test: `tests/skill-parity.test.mjs`

**Interfaces:**
- Consumes: the three internal skill contracts created in Tasks 2 and 3.
- Produces: one public workflow with explicit preflight -> optional focus shaping -> one runtime call -> result presentation phases.

- [ ] **Step 1: Add failing orchestration and documentation tests**

Require the public skill to name all three internal skills and preserve the order `preflight`, `claude-code-prompting`, `claude-cli-runtime`, `claude-result-handling`. Require README to list all four skills and state that generic write-capable task delegation is not included. Require AGENTS to assign one responsibility to each internal skill.

```js
test("public orchestration order and documentation are explicit", () => {
  const publicSkill = readSkillFrontmatter("claude-adversarial-review").source;
  const ordered = [
    "Required preflight",
    "claude-code-prompting",
    "claude-cli-runtime",
    "claude-result-handling"
  ].map((needle) => publicSkill.indexOf(needle));
  assert.ok(ordered.every((index) => index >= 0));
  assert.deepEqual([...ordered].sort((a, b) => a - b), ordered);

  const readme = readFileSync(join(projectRoot, "README.md"), "utf8");
  const agents = readFileSync(join(projectRoot, "AGENTS.md"), "utf8");
  for (const skillName of expectedSkills) assert.match(readme, new RegExp(skillName));
  assert.match(readme, /does not include.*write-capable.*task delegation/is);
  for (const skillName of expectedSkills.slice(1)) {
    assert.match(agents, new RegExp(skillName));
  }
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
node --test tests/skill-parity.test.mjs
```

Expected: FAIL on public routing and/or repository documentation.

- [ ] **Step 3: Refactor the public skill without changing behavior**

Keep the existing preflight, command, schema, evidence-grounding, and re-review rules. Replace duplicated invocation details with an explicit instruction to apply `claude-cli-runtime`; route optional narrowing through `claude-code-prompting`; route returned JSON through `claude-result-handling`. Preserve the exact public command and the one-review stop boundary.

- [ ] **Step 4: Update README and AGENTS**

Add a compact skill inventory table to README with columns `Skill`, `Visibility`, and `Responsibility`. State explicitly that this reaches reference skill-responsibility parity, not command or generic task-delegation parity. Add an `Internal skill ownership` section to AGENTS assigning invocation, output, and focus concerns to their respective skills and prohibiting cross-duplication.

- [ ] **Step 5: Run structural and skill validation**

Run:

```powershell
npm run validate
python "C:\Users\mbk\.codex\skills\.system\skill-creator\scripts\quick_validate.py" "plugins\claude-adversarial-review\skills\claude-adversarial-review"
python "C:\Users\mbk\.codex\skills\.system\plugin-creator\scripts\validate_plugin.py" "plugins\claude-adversarial-review"
```

Expected: all parity and structure tests PASS; all skill/plugin validators PASS.

- [ ] **Step 6: Commit public wiring and documentation**

```powershell
git add plugins/claude-adversarial-review/skills/claude-adversarial-review/SKILL.md README.md AGENTS.md tests/skill-parity.test.mjs
git commit -m "docs: wire Claude skill responsibility parity"
```

Apply the same no-HEAD authorization boundary from Task 1.

### Task 5: Prove behavior with isolated forward-tests

**Files:**
- Create: `.superpowers/sdd/2026-08-22-claude-skill-parity/forward-test-report.md`
- Test: all four skills and the existing fake-Claude harness.

**Interfaces:**
- Consumes: complete source skill set and synthetic temporary Git repositories.
- Produces: evidence-labeled behavioral results for root-agent and spawned-subagent use without changing product code.

- [ ] **Step 1: Run the complete automated suite on the current Node version**

```powershell
npm test
npm run validate
```

Expected: 0 failures. Record exact test counts and elapsed time in the report.

- [ ] **Step 2: Run the complete suite on Node 18.18.2**

Use the repository's established Node 18 mechanism or CI container. Run:

```powershell
npm test
npm run validate
```

Expected: 0 failures. Label inability to obtain Node 18 as `BLOCKED-NODE18`, not a pass.

- [ ] **Step 3: Forward-test the public workflow from a root agent**

In a disposable synthetic Git repository with a non-secret, one-line correctness defect, give an independent evaluating agent only this request and the installed/source skill path:

```text
Use $claude-adversarial-review to review the current working-tree change for correctness risks. Return evidence only and do not edit.
```

Assert from the actual trace that it performs preflight, invokes the companion once, preserves structured output, and stops without edits. Record `PASS-EXECUTED` or the exact blocker.

- [ ] **Step 4: Forward-test the public workflow from a spawned subagent**

Give a fresh review-only subagent the same synthetic repository and this request:

```text
Use $claude-adversarial-review as a review-only subagent. Return the structured evidence to the parent and do not adjudicate or fix it.
```

Assert one companion call, unchanged Git state, and evidence returned to the parent. Record `PASS-EXECUTED` or the exact blocker.

- [ ] **Step 5: Forward-test prompting neutrality**

Give a fresh evaluator the prompting skill and this request:

```text
Narrow an adversarial review to authentication-boundary regressions in the invitation redemption flow. Produce only the optional focus string.
```

The output must identify scope and risk lens without claiming a defect, embedding source, adding CLI flags, or instructing edits.

- [ ] **Step 6: Record evidence boundaries**

Write the report with separate sections for `PASS-EXECUTED`, `PASS-STATIC`, `FAILED`, and `BLOCKED`. Include commands, exit codes, test counts, checkout state before/after, and residual risks. Do not paste live Claude review content or secrets.

- [ ] **Step 7: Commit the forward-test report if history is authorized**

```powershell
git add .superpowers/sdd/2026-08-22-claude-skill-parity/forward-test-report.md
git commit -m "test: record Claude skill parity forward tests"
```

### Task 6: Validate source, installed cache, and fresh installed review

**Files:**
- Modify: `.agents/plugins/marketplace.json` only through the plugin-creator cachebuster helper if it is part of the supported update flow.
- Create: `.superpowers/sdd/2026-08-22-claude-skill-parity/installed-verification.md`

**Interfaces:**
- Consumes: validated source plugin, repository marketplace, configured Codex plugin installation, authenticated Claude Code session.
- Produces: source/install hash parity, new-task discovery evidence, and a fresh installed review verdict or a precise blocker.

- [ ] **Step 1: Validate repository and marketplace identities read-only**

Run the plugin-creator marketplace-name reader against `.agents/plugins/marketplace.json`, inspect `codex plugin list`, and confirm the installed marketplace identity before any update. Stop on an invalid or mismatched marketplace; do not hand-edit user configuration.

- [ ] **Step 2: Generate the supported cachebuster**

Run the plugin-creator `update_plugin_cachebuster.py` helper against `plugins/claude-adversarial-review`. Do not manually invent a version/cache suffix or edit marketplace routing by hand.

- [ ] **Step 3: Reinstall through the supported Codex plugin flow**

Use the exact marketplace/plugin identity discovered in Step 1. This is an external installation mutation: perform it only under the user's authorization at execution time. Record the command and exit status without credentials.

- [ ] **Step 4: Prove source/install parity**

Hash every source plugin file and its installed cache counterpart using relative-path plus SHA-256 tuples. Require equal path sets and equal hashes. A manifest-only match is insufficient.

- [ ] **Step 5: Verify discovery in a new Codex task**

Start a new Codex task after reinstall. Confirm that the task discovers exactly these four skills:

```text
claude-adversarial-review
claude-cli-runtime
claude-code-prompting
claude-result-handling
```

Confirm only `claude-adversarial-review` is user-facing.

- [ ] **Step 6: Run fresh installed setup and adversarial review**

From a clean synthetic repository, invoke the installed public skill once. Require unchanged Git state and valid structured evidence. Report authentication failure, deadline exhaustion, invalid output, or unavailable Claude as `BLOCKED-LIVE-CLAUDE`; do not reuse a historical review or substitute source-level tests.

- [ ] **Step 7: Write the installed-verification report**

Record source hash, installed hash, discovery result, exact installed review status, and evidence labels. Do not claim installed completion unless cache refresh, parity, new-task discovery, setup, and the fresh review all succeeded.

- [ ] **Step 8: Commit installation metadata/report only if authorized**

```powershell
git add .agents/plugins/marketplace.json .superpowers/sdd/2026-08-22-claude-skill-parity/installed-verification.md
git commit -m "chore: verify installed Claude skill parity"
```

Do not commit when marketplace metadata did not change; do not create history without authorization.

### Task 7: Final self-review and adversarial review gate

**Files:**
- Review: all files changed by Tasks 1-6.
- Modify: only files implicated by confirmed findings, using a new TDD red/green cycle.

**Interfaces:**
- Consumes: tested source, forward-test report, installed-verification report, and exact final diff.
- Produces: an adjudicated final readiness statement with no unresolved material findings hidden.

- [ ] **Step 1: Run the full final verification from a clean process**

```powershell
npm test
npm run validate
git diff --check
```

Expected: tests and validation PASS, and `git diff --check` exits 0.

- [ ] **Step 2: Inspect the exact candidate and secret-screen it**

Enumerate staged, unstaged, untracked, and branch-range material. Verify the candidate is non-empty and contains no credentials, tokens, personal data, live review output, or unrelated confidential content before invoking Claude.

- [ ] **Step 3: Run a fresh Claude adversarial review**

Invoke the installed `claude-adversarial-review` skill once against the exact final candidate with focus:

```text
skill responsibility parity, internal/public invocation boundaries, prompt neutrality, and installed discovery
```

Preserve its structured output and label it `PASS-STATIC` or `BLOCKED` according to the runtime result.

- [ ] **Step 4: Adjudicate every material finding independently**

For each finding, reproduce it against the current checkout, classify it as confirmed/rejected/blocked with evidence, and implement only confirmed fixes. Every confirmed fix starts with a focused failing test, then minimal implementation, targeted verification, full verification, and a new review of the changed candidate.

- [ ] **Step 5: Publish the final evidence ledger**

State separately:

1. source tests executed and their exact counts;
2. static validations executed;
3. installed/cache parity result;
4. fresh live Claude review result;
5. confirmed findings and their dispositions;
6. blocked or unexecuted work;
7. final Git status and whether commits exist.

Do not call the work complete if source/install parity or the fresh installed review remains blocked.

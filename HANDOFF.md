# Handoff: Claude adversarial-review plugin

Date: 2026-08-22

Repository: `D:\workspace\edwire-saas\claude-plugin-cc`

Reference repository: `D:\workspace\edwire-saas\codex-plugin-cc`

## Start here

This is a clean-sheet Codex plugin that sends local Git changes to Claude Code for one
foreground, read-only adversarial review. It uses the reference repository for skill
responsibility and packaging conventions, but it is not meant to reproduce the
reference plugin's full command, background-job, rescue, transfer, setup, agent, or hook
surface.

The source is substantially implemented and the confirmed material review findings have
been fixed with TDD. It is not release-approved yet. The repository has no commit, no
`HEAD`, no remote, and no installed plugin copy. The last Claude review ran before the
last two scanner fixes, so there is no post-fix Claude-clean verdict.

Read these files before doing anything:

1. `D:\workspace\edwire-saas\claude-plugin-cc\AGENTS.md`
2. `D:\workspace\edwire-saas\claude-plugin-cc\HANDOFF.md`
3. `D:\workspace\edwire-saas\claude-plugin-cc\.superpowers\sdd\2026-08-22-claude-skill-parity\forward-test-report.md`
4. `D:\workspace\edwire-saas\claude-plugin-cc\.superpowers\sdd\2026-08-22-claude-skill-parity\installed-verification.md`
5. `D:\workspace\edwire-saas\claude-plugin-cc\.superpowers\sdd\2026-08-22-codex-plugin-skill-parity\progress.md`

## Current repository state

- Git repository exists, but `git rev-parse --verify HEAD` fails because there is no
  initial commit.
- Every source path is untracked. After this handoff was added, `git status --short`
  should list `HANDOFF.md` as untracked along with `.agents/`, `.github/`, `AGENTS.md`,
  `README.md`, `docs/`, `package.json`, `plugins/`, `scripts/`, and `tests/`.
- No remote is configured.
- No `package-lock.json` or `node_modules` directory exists.
- `package.json` has no `dependencies` or `devDependencies`.
- No install, cache refresh, dependency install, commit, or push has been performed.
- The runtime companion's SHA-256 at handoff time is
  `45E553FA01D0A5F92B47AC5CCB3A193238879282A5BD64BB2C5CC236B0F79AA4`.
- The final 40-file source digest recorded before adding this handoff is
  `5F027E277264C324CD4D9BE8D0786B04377306AED8E8D2E73F791B2CE9A15A18`.
  Adding `HANDOFF.md` changes any whole-tree digest that includes it; do not treat that
  expected change as source drift.

Confirm the state at the start of the new session:

```powershell
Set-Location -LiteralPath 'D:\workspace\edwire-saas\claude-plugin-cc'
git status --short
git rev-parse --verify HEAD
git remote -v
Test-Path -LiteralPath 'package-lock.json'
Test-Path -LiteralPath 'node_modules'
Get-FileHash -LiteralPath 'plugins\claude-adversarial-review\scripts\claude-companion.mjs' -Algorithm SHA256
```

Expected results: all project files are untracked, `HEAD` is unresolved, no remote is
printed, both `Test-Path` calls return `False`, and the companion hash matches the value
above.

## Implemented surface

The plugin contains four skills:

- `claude-adversarial-review`: public routing skill;
- `claude-cli-runtime`: bounded source companion and lifecycle contract;
- `claude-code-prompting`: neutral focus shaping;
- `claude-result-handling`: structured evidence presentation and stop-before-fix rule.

The three internal responsibilities correspond to the reference repository's
`codex-cli-runtime`, `gpt-5-4-prompting`, and `codex-result-handling` skills. The extra
public skill is the user-facing orchestrator.

The runtime currently covers:

- staged, unstaged, untracked, and `<base>...HEAD` candidate collection;
- isolated Git metadata and index handling, including split indexes and linked
  worktrees;
- no-lazy-fetch behavior for promisor repositories;
- configured filter, textconv, external-diff, and fsmonitor neutralization;
- bounded stdin transport, strict structured output, exact evidence grounding, and
  delegation telemetry;
- secret screening across candidate input, focus, Claude stdout, and Claude stderr;
- prefixed, quoted, and camelCase sensitive assignment names while allowing proven
  function, environment, placeholder, and dotted-reference controls;
- bounded Windows process-tree cleanup and scoped Unix process-group plus observed
  lineage cleanup;
- live-probe observer and cleanup handling for timeout, nonzero exit, parser failure,
  contract rejection, and success.

The dependency-free implementation intentionally does not promise visibility into Unix
lineage that daemonizes before observation or atomic protection from the same-host PID
reuse race.

## Evidence that is current

Use these as the final-source evidence:

- Node 22 material-focused run: `59 passed, 0 failed`.
- Node 18.18.2 focused hardening run: `60 passed, 0 failed`, with `72` tests skipped by
  the name filter.
- Final independent material review: `31 passed, 0 failed`.
- Final focused security reproduction after the last scanner fixes: approved. A 128 KiB
  delimiter-heavy benign input completed in `28.09 ms`; the equivalent trailing-secret
  control completed in `25.43 ms` and was detected.
- Structural validation: `22 passed, 0 failed`.
- Syntax checks passed.
- The exact unignored unwanted-terminology scan was clean.
- No dependency or lock artifacts exist.

The latest fast Node 18 command was:

```powershell
& 'C:\Users\mbk\AppData\Local\npm-cache\_npx\a58f57f9d0f67bf3\node_modules\node\bin\node.exe' --test --test-name-pattern='reviews the current|allows ordinary secret|blocks camelCase|blocks prefixed and quoted|bounded JWT|JWT screening|full sensitive screening|assignment-chain' tests\hardening.test.mjs
```

Do not present the earlier broad counts as final-source evidence. Immediately before the
last scanner corrections, the broad runs reached `164/164` for the companion suite on
both Node versions and `157 passed / 4 platform skips` for hardening. The derivable
canonical total was `381 passed / 5 platform skips`. Source changed afterward, so those
results are useful history, not a current full-suite pass.

## Claude review history

All reviews below ran through the already-installed Claude advisor infrastructure. They
reviewed this source checkout; they did not prove that the new plugin was installed or
discoverable.

- `adversarial-review-mt4ehu8i-suzxd8`: `1 BLOCKER`, `5 MAJOR`, `8 MINOR`.
  Confirmed source findings were fixed. The blocker was the missing authorized install
  and live-path verification.
- `adversarial-review-mt4gln25-01wwpx`: `4 MAJOR`. Confirmed secret-shape,
  live-probe cleanup, and production screening findings were fixed with TDD.
- `adversarial-review-mt4isaso-wa09mu`: `2 MAJOR`, `5 MINOR`. Both major findings were
  independently reproduced: delimiter-heavy assignment input caused quadratic scanning,
  and camelCase sensitive names bypassed classification. Both were fixed. Independent
  post-fix checks approved the corrected source.

Claude was not rerun after the final two major fixes because the user asked to finish
without another long review cycle. Do not call the current state Claude-approved. The
next session should obtain one fresh post-fix Claude review after the current full source
suite is green.

The last review's minor observations were not re-evaluated after the final fixes:

- backtick-delimited values use the unquoted threshold;
- some quoted safe references and template placeholders may fail closed;
- the live probe can lose the originating error if cleanup fails, and an observer attach
  failure needs explicit lifecycle review;
- no minimum Git version is documented for `GIT_NO_LAZY_FETCH` support;
- the Claude session reported partial source-read coverage.

Treat these as review claims, not confirmed defects. Reproduce them before editing.

## What remains unfinished

### 1. Run a current full suite

The last source edit changed the scanner after the broad suite. Run both complete pinned
suites on the final source. These process-heavy suites were flaky when competing for the
same Windows process resources, so run the Node versions sequentially even if other
read-only audits use subagents in parallel.

```powershell
Set-Location -LiteralPath 'D:\workspace\edwire-saas\claude-plugin-cc'
npm test
& 'C:\Users\mbk\AppData\Local\npm-cache\_npx\a58f57f9d0f67bf3\node_modules\node\bin\node.exe' scripts\run-tests-sequentially.mjs
npm run validate
```

Then run syntax checks:

```powershell
Get-ChildItem -LiteralPath . -Recurse -File -Filter '*.mjs' |
  Where-Object { $_.FullName -notmatch '\\.git\\' } |
  ForEach-Object {
    & node --check $_.FullName
    if ($LASTEXITCODE -ne 0) { throw "Syntax check failed: $($_.FullName)" }
  }
```

Update the forward report and progress ledger with exact counts, exit codes, elapsed
times, and a new final-tree digest. Keep current, superseded, static, and blocked evidence
separate.

### 2. Run a fresh Claude adversarial review

Use the installed `claude-code-advisor:claude` skill and its bundled companion. Do not
call the Claude CLI directly. Capture a pre-review source manifest/digest, run one fresh
`xhigh` adversarial review against the final tree, and compare the digest afterward.

Adjudicate every material finding against current code and tests. If a finding is
confirmed, add a failing test first, fix it, rerun the affected tests, and rerun Claude.
A completed review is evidence, not approval.

Do not broaden into the five historical minor observations unless they reproduce or the
user explicitly asks to include them.

### 3. Obtain authorization before installed verification

The following gates require external mutation and remain blocked:

- install or cache refresh for this repository's plugin;
- source/install SHA-256 parity;
- discovery and actual skill triggering in a fresh root task;
- discovery and routing in a fresh spawned subagent;
- one live review through the newly installed plugin.

Ask for explicit authorization before doing any of these. If authorized, read the
current `plugin-creator` skill first and use its supported cachebuster/reinstall flow.
Do not hand-edit plugin caches or marketplace configuration. Verify the repository
marketplace manifest before mutation, compare source and installed hashes, then start a
new task so skill discovery does not reuse stale state.

An earlier sibling-plugin session encountered an invalid unrelated `wt-local`
marketplace configuration. That may be stale. Check the current configuration read-only
instead of assuming the old failure still exists.

### 4. Platform evidence

This Windows host cannot execute the POSIX invalid-filename/literal-pathspec integrations
or the Unix escaped-session end-to-end cleanup test. Linux CI exists but has not run
because the repository has no commit or push. Record these as blocked unless a suitable
host is available.

### 5. Repository initialization

Do not create the initial commit, configure a remote, push, publish, add dependencies, or
install the plugin without explicit user approval. If the user authorizes repository
initialization, review the complete untracked tree before staging; avoid broad staging
until the intended contents are confirmed.

## Constraints that still apply

- Do not add dependencies. The reference repository has only TypeScript and Node type
  development dependencies; this repository deliberately has none.
- Use PowerShell for long commands on this Windows machine.
- Preserve read-only review behavior and never echo detected credential-like values.
- Keep install/cache operations, commits, pushes, and external writes behind explicit
  authorization.
- Use subagents for independent, non-overlapping work. Do not run the two full Node
  matrices concurrently because they contend for process resources.
- Keep review results, independent adjudication, executed tests, static evidence, and
  blocked gates labeled separately.

## Recommended next prompt

Use this in a new session:

> Work in `D:\workspace\edwire-saas\claude-plugin-cc`. Read `AGENTS.md` and
> `HANDOFF.md` completely. Use subagents for independent read-only audits, but run the
> complete Node 22 and Node 18 suites sequentially. Update the evidence ledger with the
> final counts, then run one fresh Claude adversarial review through the installed
> advisor skill and independently adjudicate material findings. Do not add dependencies,
> install or refresh the new plugin, mutate caches, commit, configure a remote, or push
> without asking me first.


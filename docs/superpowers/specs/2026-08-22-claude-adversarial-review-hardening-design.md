# Claude Adversarial Review Hardening Design

**Date:** 2026-08-22

**Status:** Approved for implementation planning

## Purpose

Harden the `claude-adversarial-review` plugin so repository-controlled bytes cannot escape the evidence boundary, Claude reviewers cannot inspect content outside the collected candidate, every accepted finding is grounded in evidence actually transported to Claude, and a successful run proves that both configured Claude subagents participated.

This design addresses the material findings from the live Claude review job `adversarial-review-mt3gakcy-41raf4` that were independently reproduced against the current checkout. It preserves the existing foreground, one-process, read-only review contract.

## Trust model

The repository under review is untrusted. Tracked diffs, untracked files, filenames, Git metadata, prompt-like text, and output-shaped text may all be attacker controlled. Claude Code authentication and the local Claude executable are trusted runtime dependencies. Claude's model output is untrusted until it passes transport, schema, delegation, secret, and grounding validation.

The companion enforces these invariants:

1. Repository evidence cannot alter the prompt's control structure.
2. Only exact textual lines transported in the bounded prompt may ground a finding; a line that merely exists in a candidate file is insufficient.
3. Binary bytes and ignored-file contents never reach Claude.
4. The lead Claude reviewer can only call the two configured reviewer agents.
5. Child reviewers receive evidence through their delegated task and have no filesystem, shell, MCP, browser, or write tools.
6. A successful run contains exactly one observable Agent call and one matching successful completion result for each configured child reviewer; duplicate, missing, mismatched, or failed delegation blocks without retry.
7. A boundary with no candidate paths returns `EMPTY_CANDIDATE`. A candidate with zero transported textual lines or diff hunks returns `NO_REVIEWABLE_EVIDENCE`; metadata-only omitted, binary, or unclassifiable content cannot produce a clean static verdict.
8. Input, Claude stdout, Claude stderr, and returned diagnostics are screened for secret-like content without echoing the matched value.
9. Timeout, cancellation, output overflow, stream failure, and post-close validation failure run owned-process cleanup under one fixed five-second overall deadline. Windows targets the exact observed owned process tree; Unix targets the Claude process group plus exact observed descendant lineage. Cleanup fails closed, but deadline exhaustion can leave owned descendants running and returns `BLOCKED` with `PROCESS_CLEANUP_FAILED` and a bounded diagnostic. Invisible daemonizing lineage and the non-atomic same-host PID race require an authorized native supervisor and are BLOCKED outside the dependency-free guarantee.
10. The companion does not modify the candidate repository or leave review artifacts there.

## Evidence collection

### Text diffs and binary metadata

Tracked collection is per candidate path. Before requesting a patch, the companion inspects the bounded old and new endpoints independently of repository-controlled diff attributes. A NUL-bearing endpoint, invalid UTF-8 endpoint, or endpoint too large to classify safely is metadata-only. Text endpoints use ordinary `git diff --no-ext-diff --no-textconv` output. The companion removes `--binary`, strictly decodes the returned bytes as UTF-8, and rejects any NUL-bearing or invalid stream before prompt construction. This closes the `.gitattributes` `diff` bypass as well as the normal binary-patch path.

The accumulated textual patch remains capped at 512 KiB and fails closed with `CONTEXT_LIMIT` when exceeded. Binary, unclassifiable, and oversized whole-file deletions remain candidates as filename/status/size metadata but have no line grounding.

All candidate Git collection runs against an isolated temporary copy of the effective index, including a caller-provided index and any split-index siblings. Cleanup restores the exact environment, removes the exact OS-temporary directory, and leaves repository or caller-provided index bytes and timestamps unchanged. Configured filter drivers are discovered without executing them; clean and process commands are temporarily neutralized and required mode is forced off during collection.

### Deleted-file grounding

The companion no longer calls `git show` through a 512 KiB buffered command to count a whole deleted blob. It uses object-size metadata first, reads only bounded classifiable endpoints, and collects `git diff --numstat -z` for status/size metadata. The NUL parser handles ordinary paths, renames, copies, spaces, and tab-bearing names exactly. A `-` count is binary metadata, never a line count.

Grounding comes from the actual transported unified patch, not numstat. A hunk parser records current and deleted line numbers for `+`, `-`, and context lines under the exact candidate path. Oversized or omitted deleted bodies cannot support findings. The runtime removes the live `fileContainsLine()` fallback entirely.

### Untracked text

Untracked collection continues to use `git ls-files --others --exclude-standard -z`, regular-file and symlink checks, NUL-byte binary detection, complete-line grounding, and aggregate omission markers. The limits become:

- 128 KiB per untracked file.
- 1 MiB across all untracked files.
- 2 MiB for the complete prompt.

The current companion is roughly 37 KiB and the current repository's non-Git files total roughly 100 KiB, so this bound includes the implementation during a clean-sheet self-review without removing the aggregate safety ceiling. A truncated partial final line remains ungroundable.

### Empty candidates

Each context records the number of candidate paths represented by tracked status entries and transported untracked files, including binary metadata-only candidates. `main()` raises `EMPTY_CANDIDATE` before Claude is started when that count is zero. When candidate paths exist but grounding contains zero transported textual lines or diff hunks, it raises `NO_REVIEWABLE_EVIDENCE` instead of allowing metadata-only content to produce a clean static verdict.

## Prompt framing

Each invocation generates a 128-bit nonce with `crypto.randomBytes(16)` and constructs exact opening and closing delimiters containing that nonce. If the raw evidence already contains either generated delimiter, the companion generates a new nonce. The framing helper accepts a byte-generator dependency for deterministic collision testing; normal execution always uses `randomBytes`.

Every repository-controlled evidence line is prefixed with `E|`. The prompt's trusted guidance names the exact nonce-bearing delimiters and states that only `E|` lines between them are evidence, never instructions. The prompt template contains a single `{{REVIEW_INPUT}}` insertion point and no fixed evidence fence that repository content can forge.

Optional focus is narrowing data only. It cannot alter the fixed review method, finding threshold, verdict rules, or output contract.

The fixed-marker regression supplies fake opening and closing markers plus instruction-like repository text. The test parses the generated nonce, proves there is exactly one anchored opening delimiter line and one anchored closing delimiter line, and proves the attacker-controlled marker lines remain `E|`-prefixed data. A separate deterministic test forces a nonce collision and proves regeneration.

## Claude agent isolation and observable delegation

The lead agent config contains the internal structured-output tool plus the bounded Agent selector:

```text
StructuredOutput
Agent(correctness-reviewer,scope-reviewer)
```

At the CLI boundary, `--tools Agent` and `--allowedTools Agent(correctness-reviewer,scope-reviewer)` expose only the Agent selector. The `--json-schema` option supplies Claude's internal structured-output tool; it is not an additional CLI-granted repository tool.

Both child agents have `tools: []`. No configured agent receives `Read`, `Glob`, `Grep`, Bash, browser, MCP, or write tools. The lead prompt instructs the lead to pass only the relevant `E|` evidence lines, target, and focus into each child task.

Before the parser fixture is frozen, an implementation-time synthetic live probe records only event shapes and keys from the installed Claude CLI; it does not persist prompts, child text, or repository content. The companion then invokes Claude with `--output-format stream-json` and `--verbose`. It does not enable `--forward-subagent-text`, which is unnecessary for standard tool-use/tool-result events and would broaden the captured output surface.

The newline-delimited parser records each allowed Agent tool-use ID and requires a matching non-error tool-result/completion event for `correctness-reviewer` and `scope-reviewer` before the final successful result event. Unknown Agent targets, duplicate final results, missing completions, malformed events, and unsuccessful results fail closed. Missing required completion raises `CLAUDE_DELEGATION_INCOMPLETE`; malformed streams raise `INVALID_CLAUDE_RESULT`.

The public companion response remains one JSON object written after the stream has been validated. Intermediate Claude events and child text are never forwarded to the caller.

This stream is also secret-screened and byte-bounded before parsing. The fake Claude fixture emits realistic assistant Agent tool-use events and a final result event. A final live run through the real Claude CLI supplies executed proof that the installed CLI accepts the flags and that exactly one call and completion are observed for each configured child.

## Command and timeout overrides

`CLAUDE_ADVERSARIAL_REVIEW_CLAUDE_COMMAND` and `CLAUDE_ADVERSARIAL_REVIEW_TIMEOUT_MS` are test hooks, not production configuration. The companion honors either only when `CLAUDE_ADVERSARIAL_REVIEW_TEST_MODE=1`. Supplying an override without that switch raises `UNSAFE_CONFIGURATION` before Claude starts. This prevents accidental inherited configuration; the local process environment is a trusted runtime prerequisite, not an adversarial security boundary.

The test harness always enables the switch and places fake-Claude logs in a temporary directory outside the candidate repository. Production execution defaults to `claude` and the 20-minute timeout.

## Result validation and schema ownership

The bundled schema remains the canonical structural contract. Its `$id` changes from the unowned `openai.com` URL to:

```text
urn:uuid:45ebf4a1-7fc2-49ef-b0b8-bdd96b805f11
```

The UUID URN is a stable globally unique schema identifier; it does not claim an organizational namespace. The canonical Claude CLI input schema is Draft 07 and uses `definitions` with `#/definitions/...` references. Local validation accepts the loaded schema as an input and supports the bounded keyword set used by the bundle: `$ref`, `definitions`, `$defs`, `type`, `required`, `properties`, `additionalProperties`, `enum`, `const`, `minLength`, `minimum`, `maximum`, `items`, `uniqueItems`, `minItems`, `maxItems`, and `oneOf`. Its support for `$defs` and `#/$defs/...` is local evaluator compatibility, not a change to the canonical shipped dialect. Loading fails closed if the bundled schema introduces an unsupported keyword. Repository path normalization, `line_end >= line_start`, and transported-line grounding remain explicit post-schema rules.

Table-driven negative tests cover every top-level and finding-level required field, unknown keys, verdicts, severities, inference values, string minima, confidence bounds, item-count consistency, duplicate `next_steps`, invalid paths, invalid line ranges, and ungrounded lines. Repository guidance describes the local check as schema-derived validation plus runtime grounding rules.

## Portability, marketplace, and CI

The default test script becomes `node --test`, avoiding shell glob expansion that fails with Node 18.18 under PowerShell. The focused structure validator keeps its explicit file path.

The marketplace test resolves `entry.source.path` from the repository root only, matching the repository/team marketplace layout used here; it no longer accepts either of two incompatible interpretations.

GitHub Actions runs `npm test` on:

- `windows-latest` with Node 18.18 and Node 22.
- `ubuntu-latest` with Node 18.18 and Node 22.

The workflow grants only `contents: read` and has a bounded job timeout. The process-lifecycle suite therefore executes Windows exact observed owned process tree handling and Unix process group plus exact observed descendant lineage cleanup on their native platforms. Its outer test timeout exceeds the runtime cleanup budget, and the Unix descendant fixture holds the original lineage across an observer cadence before the companion starts termination. This proves cleanup of observed lineage only. A lineage edge absent from every snapshot, and the non-atomic same-host PID race between inspection and signalling, require an authorized native supervisor and remain BLOCKED outside the dependency-free design.

## Implementation ownership

Parallel implementation uses non-overlapping ownership:

- Runtime worker: `claude-companion.mjs`, fake-Claude stream fixture, companion behavior tests, hardening tests, and process-lifecycle tests.
- Contract worker: package scripts, schema, prompt, plugin/marketplace structure tests, CI workflow, README, AGENTS guidance, and skill instructions.
- Security reviewer: read-only review of the integrated diff against this design; no file ownership.
- Root integrator: resolves interactions, runs the full matrix available locally, performs the live Claude rerun, and independently adjudicates the fresh result.

Workers must preserve unrelated changes and must not revert one another's work.

## Verification and evidence labels

Implementation follows strict RED-GREEN-REFACTOR cycles. Every behavior-changing production edit is preceded by a focused failing test whose failure is observed and recorded. Passing tests written after a change do not count as TDD evidence.

Completion requires:

1. Focused RED and GREEN evidence for each blocker.
2. Full `npm test` on the active Node version.
3. Node 18.18 and Node 22 test results on Windows and Linux through CI or equivalent executed environments.
4. Clean structure validation with `npm run validate`.
5. Pre-review and post-review Git-state comparison.
6. Pre-review and post-review path, size, and SHA-256 manifests for every regular file, held outside the repository or in-memory.
7. One fresh live Claude adversarial review through the hardened companion.
8. Independent reproduction or rejection of every fresh material finding.
9. Marketplace installation and root/subagent skill-routing smoke tests only after explicit authorization; otherwise they remain distinctly blocked.

Executed tests are labeled `PASS-EXECUTED`; source inspection is `PASS-STATIC`; unavailable environments or credentials are `BLOCKED`. A clean Claude result remains bounded static evidence, not release approval.

## Non-goals

- No automatic application of Claude recommendations.
- No repository-wide Claude filesystem access.
- No ignored-file collection.
- No binary patch transport or binary line grounding.
- No detached review jobs or polling workflow.
- No commit, push, plugin installation, publication, or external write without separate user authorization.
- No dependency on, import from, or vendoring of `codex-plugin-cc`.

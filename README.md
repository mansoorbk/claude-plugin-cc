# claude-adversarial-review

`claude-adversarial-review` asks Claude Code for a second, adversarial review of local Git changes. Codex remains responsible for checking the findings and deciding whether the work is ready.

This is a clean-sheet project. It does not import, vendor, or depend on `codex-plugin-cc`.

## Prerequisites

- Node.js 18.18 or newer
- Git
- Claude Code installed and authenticated for a live review

Claude Code owns authentication. Do not put credentials in this repository or pass them to the plugin.

## Install from this repository

This repository has a local marketplace named `claude-plugin-cc`. From a Codex CLI that supports plugins, add the repository as a marketplace and then install the plugin:

```powershell
codex plugin marketplace add "D:\workspace\edwire-saas\claude-plugin-cc"
codex plugin add claude-adversarial-review@claude-plugin-cc
```

Start a new Codex task after installation so the skill catalog is refreshed. These installation commands have not been executed in this checkout, so installation and discovery are not yet verified.

## Invoke the skill

The exact skill form is:

```text
$claude-adversarial-review:claude-adversarial-review [--base <ref>] [focus]
```

Examples:

```text
$claude-adversarial-review:claude-adversarial-review
$claude-adversarial-review:claude-adversarial-review --base origin/main queue delivery retry behavior
```

With `--base`, the review compares `<base>...HEAD`. Without it, the candidate includes staged, unstaged, and bounded untracked text. The optional focus narrows the concern without prescribing an answer.

The skill is intended for root Codex agents and spawned subagents. It makes one foreground call through the bundled companion and returns the result to the caller. It must not start a detached job or call Claude directly.

## Skill responsibilities

The plugin exposes four skills. Only `claude-adversarial-review` is user-facing; it is the public orchestrator for one bounded review.

| Skill | Visibility | Responsibility |
| --- | --- | --- |
| `claude-adversarial-review` | User-facing | Verifies preflight and routes the bounded workflow. |
| `claude-code-prompting` | Internal | Optionally turns a review concern into a compact focus string without supplying evidence or a conclusion. |
| `claude-cli-runtime` | Internal | Runs the installed companion exactly once, in the foreground and read-only, from the verified Git cwd. |
| `claude-result-handling` | Internal | Presents structured static-review evidence, labels it, and stops before fixes. |

This responsibility parity is deliberately narrow. It does not include generic write-capable task delegation or command parity with `codex-plugin-cc`; the plugin has no coding, diagnosis, research, background-job, status, resume, cancellation, model-selection, or effort-selection command surface.

## Read-only and privacy boundary

The companion transports a bounded candidate as nonce-framed, `E|`-prefixed evidence. Repository-controlled text is data, never prompt structure or instructions. Binary and unclassifiable bytes are omitted from the transported body, and an empty candidate blocks before Claude starts.

The runtime returns `EMPTY_CANDIDATE` for zero candidate paths and `NO_REVIEWABLE_EVIDENCE` for zero transported textual lines or diff hunks; both stop before Claude. Metadata-only omitted, binary, or unclassifiable content cannot yield a clean static verdict. Focus is bounded, single-line, control-free data. Structured result strings have explicit maximum lengths. Untracked Git names are decoded with fatal UTF-8 from NUL-delimited bytes and fail closed when undecodable. All Git inspection uses global `--no-optional-locks` and `--literal-pathspecs`. Candidate Git collection uses an isolated temporary Git index copied from the effective index and leaves repository or caller-provided index state unchanged. It discovers configured filters without executing them and neutralizes clean and process filter drivers during collection.

The companion starts one foreground Claude process. Its agent config gives the lead internal `StructuredOutput` plus the bounded Agent selector `Agent(correctness-reviewer,scope-reviewer)`. At the CLI boundary, `--tools Agent` and `--allowedTools Agent(correctness-reviewer,scope-reviewer)` expose only that Agent selector; `--json-schema` supplies the internal structured-output tool. Both child reviewers have no repository, filesystem, shell, browser, MCP, or write tools. Each configured child reviewer is required exactly once. A successful result requires one correlated `task_started` and one `task_notification` for each child, matched by `task_id` and `tool_use_id`; the notification status must be `completed` or `succeeded` with no error indicator. Duplicate, missing, mismatched, or failed delegation blocks without retry.

The bundled result schema is evaluated locally using its supported keyword set. The runtime then enforces verdict/findings coherence, repository-relative path normalization, cross-field line-range checks, and exact transported-line grounding. Only exact textual tracked-hunk lines (including transported deleted lines) and complete transported untracked lines can ground a finding. A deletion summary, omitted or oversized deletion body, filename, binary metadata, or a line merely present in the checkout cannot.

Claude settings, hooks, plugins, and tool grants are isolated from repository and user settings. The test-only command and timeout overrides require explicit test mode. Captured input, stdout, stderr, and diagnostics are screened for secret-like material before handoff.

Owned-process cleanup is bounded by one fixed five-second overall deadline and fails closed. Windows cleanup targets the exact observed owned process tree; Unix cleanup targets the Claude process group plus exact observed descendant lineage. If the deadline expires or termination cannot be confirmed, owned descendants may remain running and the review returns `BLOCKED` with `PROCESS_CLEANUP_FAILED` and a bounded diagnostic. Invisible Unix lineage and the non-atomic same-host PID race require an authorized native supervisor and remain outside the dependency-free guarantee.

Review the exact candidate material before a live run. Diffs and bounded untracked text may be sent to Claude Code. Stop if they contain credentials, tokens, personal data, or unrelated confidential material. Do not rely on the plugin to make unsafe input safe.

The review must not edit, stage, commit, push, deploy, or write to external systems. Findings are static leads. Reproduce each material finding in the current checkout, then run the tests or runtime checks required by the underlying change. A clean review is not ship approval.

## Tests

Run the structure checks with Node:

```powershell
node --test tests/plugin-structure.test.mjs
```

Run the complete local test suite with Node:

```powershell
npm test
```

The tests use a fake Claude process. They do not prove that Claude authentication, marketplace installation, root skill discovery, spawned-subagent skill routing, or a live review works.

## Status

The checkout contains the plugin manifest, skill, companion, prompt, schema, and local tests. `BLOCKED-PLUGIN-INSTALL`, `BLOCKED-ROOT-SKILL-ROUTING`, and `BLOCKED-SUBAGENT-SKILL-ROUTING` remain open until separately authorized installation and smoke tests run. Live Claude execution is also unverified here. Treat these as open verification steps, not completed features.

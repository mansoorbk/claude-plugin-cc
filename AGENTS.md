# Repository guidance

This repository contains the Codex plugin `claude-adversarial-review`. The plugin asks Claude Code for a second, adversarial review of work in the current repository and returns the findings to the invoking Codex agent.

## Scope

- Treat this as a clean-sheet implementation.
- `codex-plugin-cc` may be consulted as a behavioral reference only. This repository must not depend on it, import it, vendor it, or copy its implementation.
- Keep plugin code under `plugins/claude-adversarial-review/` and marketplace metadata under `.agents/plugins/`.
- Do not add product-specific EdGraph behavior to the generic plugin.

## Command contract

The intended user-facing command is:

```text
$claude-adversarial-review:claude-adversarial-review [--base <ref>] [focus]
```

`--base <ref>` supplies the Git comparison boundary. The optional `focus` text narrows the review without prescribing the answer.

The command must work when invoked by a root Codex agent or a Codex subagent. In either case it runs in the foreground and returns Claude's review to the caller. It must not create a detached job that the user has to poll.

## Safety and evidence

- The companion inspects the repository and Git state read-only; Claude receives only the bounded transported evidence. Neither may edit files, stage changes, commit, push, deploy, or write to external systems.
- Before a live invocation, inspect the exact staged, unstaged, untracked, and branch-range material that will be collected. If it contains a credential, token, personal data, or unrelated confidential content, stop. Never pass that material to Claude or persist it in fixtures, logs, snapshots, or error envelopes.
- Use synthetic sentinels in tests. Secret screening must cover the scoped diff, bounded untracked files, captured stdin, stdout, stderr, and any temporary artifact before handoff.
- The runtime returns `EMPTY_CANDIDATE` for zero candidate paths and `NO_REVIEWABLE_EVIDENCE` for zero transported textual lines or diff hunks; both stop before Claude. Metadata-only omitted, binary, or unclassifiable content cannot yield a clean static verdict. Focus is bounded, single-line, control-free data. Structured result strings have explicit maximum lengths. Untracked Git names are decoded with fatal UTF-8 from NUL-delimited bytes and fail closed when undecodable. All Git inspection uses global `--no-optional-locks` and `--literal-pathspecs`. Candidate Git collection uses an isolated temporary Git index copied from the effective index and leaves repository or caller-provided index state unchanged. It discovers configured filters without executing them and neutralizes clean and process filter drivers during collection.
- Isolate Claude settings. The runtime must not load repository or user Claude settings, hooks, plugins, or tool grants. Use an explicit empty settings source or an equivalent tested mechanism; authentication remains in Claude Code's normal authenticated session and must not be copied into this repository.
- Keep one Claude process. Supply the bounded reviewers through `--agents` and select the lead agent explicitly. The agent config gives the lead internal `StructuredOutput` plus the bounded Agent selector. At the CLI boundary, `--tools Agent` and `--allowedTools Agent(correctness-reviewer,scope-reviewer)` expose only that Agent selector; `--json-schema` supplies the internal structured-output tool. Every child has no repository, filesystem, shell, browser, MCP, or write tools. Require each configured child reviewer exactly once: one `task_started` and one successful `task_notification`, correlated by `task_id` and `tool_use_id`, with `completed` or `succeeded` status and no error indicator. Duplicate, missing, mismatched, or failed delegation blocks without retry. Subagent conclusions remain leads for the lead reviewer to reconcile.
- Treat the JSON schema as an enforced boundary. Require `verdict`, `findings`, `confidence`, and `recommendation`; reject unknown fields, invalid severity/evidence, malformed JSON, or prose fallback. The runtime, not the schema, enforces material/static verdict and findings coherence. Evaluate Claude's `structured_output` against the bundled schema's supported keyword set, then apply verdict/findings coherence, repository-relative path normalization, cross-field line-range, and transported-grounding rules before returning it.
- Findings are evidence to adjudicate, not instructions to apply automatically and not approval to complete a task.
- The invoking agent must reproduce or otherwise verify each material finding against the current checkout before acting on it.
- A claimed fix does not close a finding. Run fresh targeted verification, then broader relevant checks. Re-run adversarial review when the fix is material, security-sensitive, changes the reviewed design, or leaves uncertainty about adjacent regressions.
- A clean re-review does not replace builds, tests, static checks, or runtime evidence required by the underlying task.
- Report executed, static-only, failed, and blocked evidence distinctly. Do not imply verification that was not run.

## Public skill and internal responsibility boundary

`claude-adversarial-review` is the only user-facing skill and is responsible only for preflight and workflow orchestration. It routes optional focus shaping to `claude-code-prompting`, the one companion invocation to `claude-cli-runtime`, and output presentation to `claude-result-handling`, in that order.

- `claude-code-prompting` owns optional focus-string composition. It does not inspect or carry repository evidence, prescribe findings, invoke the companion, or present results.
- `claude-cli-runtime` owns the one foreground, read-only companion invocation from the preflight-verified cwd. It does not shape focus, interpret findings, or perform fixes.
- `claude-result-handling` owns output ordering, evidence labels, and the stop-before-fix boundary. It does not invoke the companion, write fixes, or substitute blocked output for analysis.

Do not duplicate invocation, focus, or output contracts across these skills. Responsibility parity is not generic task delegation or command parity: no skill may add write-capable coding, diagnosis, research, rescue, background-job, status, resume, cancellation, model-selection, or effort-selection behavior.

## Development requirements

- Support Node.js 18.18 or newer.
- Require an installed, authenticated Claude Code session; do not collect or persist Claude credentials in this repository.
- Prefer small modules with explicit inputs, structured results, bounded output, and actionable error messages.
- Preserve the caller's working tree. Temporary files must be isolated and removed safely.
- On timeout, cancellation, output overflow, stream failure, or post-close validation failure, close stdin and run bounded owned-process cleanup under one fixed five-second overall deadline. On Windows, target and confirm the exact observed owned process tree. On Unix, target the Claude process group plus exact observed descendant lineage. Cleanup fails closed: deadline exhaustion or unconfirmed termination may leave owned descendants running and must return `BLOCKED` with `PROCESS_CLEANUP_FAILED` and only a bounded diagnostic. Invisible daemonizing lineage and the non-atomic same-host PID race are outside the dependency-free guarantee and remain BLOCKED unless an authorized native supervisor is added. Remove isolated temporary artifacts only within that bounded failure path.
- Keep commands portable across supported Codex environments. On this Windows workspace, use PowerShell for heavy commands; Bash commands longer than 893 bytes are rejected.

## Verification before handoff

Verify only what the current implementation supports, and record the exact command and result. At minimum:

1. Inspect the scoped diff and screen it for secrets or captured review content.
2. Validate the manifest, marketplace identity, skill, prompt, and strict result schema.
3. Exercise settings isolation and bounded Claude Agent subdelegation with the fake Claude fixture.
4. Test malformed output and cancellation/timeout cleanup: Windows exact observed owned process tree termination, plus Unix process group and exact observed descendant lineage termination. Report invisible Unix lineage and same-host PID-race coverage as BLOCKED without an authorized native supervisor.
5. Confirm pre-review and post-review Git state is identical.

Do not claim that installation, live Claude execution, authentication, or end-to-end review works unless each was exercised in the current checkout. Report executed, static-only, failed, and blocked evidence separately.

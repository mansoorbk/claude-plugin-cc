# Handoff: Claude adversarial-review plugin

Date: 2026-08-22

Repository: `D:\workspace\edwire-saas\claude-plugin-cc`

Reference repository: `D:\workspace\edwire-saas\codex-plugin-cc`

## Current state

The release-readiness closure is checked into local `main`; use `git rev-parse HEAD` for its exact commit. Remote `origin/main` remains at the pre-closure base `721b971ac3077f39b06dd4c6954b532777182bc8` until an authorized push.

This is a dependency-free, review-only Codex-to-Claude Code plugin. It deliberately differs from `codex-plugin-cc`: it has four skills, version `0.1.0`, and no background-job, rescue, transfer, status, setup, agent, or hook surface. Those differences are product decisions, not parity gaps.

The current source and tests contain a hosted-Windows cleanup fix. It is not release-approved: the post-fix hosted matrix, a fresh Claude adversarial review, and all installed-plugin verification remain open.

## Current local evidence

- `PASS-EXECUTED-AUTHORITATIVE`: frozen-tree sequential Node 22 matrix: eight canonical files, `409 passed, 0 failed, 5 host-inapplicable skips`.
- `PASS-EXECUTED-SUPPORTING`: pinned Node 18.18.2 matrix run concurrently with an earlier Node 22 pass: eight canonical files, `409 passed, 0 failed, 5 host-inapplicable skips`.
- `PASS-EXECUTED`: lifecycle TDD closeout: `37 passed, 0 failed, 1 skip`.
- `PASS-EXECUTED`: structural validation: `22 passed, 0 failed`; all repository `.mjs` syntax checks passed; the terminology scan returned only the expected Git `--binary` harness arguments.
- `PASS-EXECUTED`: 42-file release-payload identity (excluding this handoff and the two self-referential status documents): raw SHA-256 `bd8b838e678a14327d4717d66cb605f4451cab46d791460a5f261953c4529e8e`; Git-blob-manifest SHA-256 `2d7698b74e5d95a288bf55f61cf9c6e828aa611f9bff54f831d386abf238482f`.
- `HISTORICAL`: GitHub Actions run `32583592405` passed both Ubuntu cells but failed both Windows cells before this fix with `PROCESS_CLEANUP_FAILED`. There is no post-fix hosted CI run.

The Windows correction adds one retry only for the first PowerShell/CIM descendant snapshot. It stays inside the existing 5,000 ms cleanup deadline and 3,000 ms helper cap. A retried identity-less snapshot is accepted only when empty; a non-empty retry, persistent snapshot failure, helper-deadline failure, or root-PID reappearance fails closed before `taskkill`.

## Review history

The three prior Claude reviews were performed before the current Windows cleanup change. Their confirmed findings were fixed in earlier work, but none is a post-fix clean verdict. A fresh supported Claude adversarial review is still required after the final source identity is recorded.

The ignored `.superpowers/sdd` files in the original checkout are local historical material. This handoff, release report, and implementation plan are versioned with the closure commit.

## Open gates

- `BLOCKED-EVIDENCE`: working-tree Claude review `adversarial-review-mt4nd2uy-7ng93d` completed and was independently adjudicated, but it did not issue a clean verdict. The candidate retry remains gated on post-fix hosted Windows CI.
- `BLOCKED-AUTHORIZATION`: push local `main` to obtain a fresh four-cell Ubuntu/Windows × Node 18.18.2/22.x GitHub Actions matrix.
- `BLOCKED-AUTHORIZATION`: marketplace cache refresh/install, source/install hash parity, fresh root discovery, fresh subagent discovery, and one live installed review.
- `BLOCKED-LOCAL-VALIDATOR`: the plugin-creator Python ingestion validator needs PyYAML locally. Do not install dependencies merely to clear this gate.

No push, plugin install, cache change, or live installed invocation has been performed.

## Constraints

- Do not add dependencies, a lockfile, or `node_modules`.
- Preserve foreground, read-only review behavior; do not expose candidate evidence or credential-like values.
- Keep process-heavy release evidence isolated from source edits and record at least one frozen-tree matrix sequentially; Node 22 is the current authoritative run.
- Do not hand-edit plugin caches or marketplace configuration.
- Keep executed, historical, pending, and authorization-blocked evidence separate.

## Recommended continuation

Ask for explicit authorization to push and obtain the post-fix hosted matrix. Do not perform marketplace/install/cache/live-review actions without separate explicit authorization.

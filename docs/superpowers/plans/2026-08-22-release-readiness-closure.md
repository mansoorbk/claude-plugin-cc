# Claude adversarial-review release-readiness closure plan

**Goal:** Close the actionable release-readiness gaps for the focused `claude-adversarial-review` plugin without expanding it into the reference plugin's command or background-job product.

**Architecture:** Keep the dependency-free, foreground, read-only Codex-to-Claude review flow. Source validation, Claude review, hosted CI, installation, discovery, and live execution are separate gates.

## Constraints

- Keep the independent `0.1.0` release base, four-skill composition, review-only surface, and zero dependencies.
- Keep process-heavy matrices isolated from source edits and record at least one frozen-tree matrix sequentially.
- Do not install dependencies, edit caches/configuration, commit, push, install, or invoke a live installed plugin without explicit authorization.
- Keep current, historical, pending, and blocked evidence distinct.

## Progress

### Task 1: Source identity and dual-runtime baseline

- [x] Record preflight state from base `721b971ac3077f39b06dd4c6954b532777182bc8`.
- [x] Run the post-fix Node 22 matrix sequentially on the frozen tree: eight canonical files; `409 passed, 0 failed, 5 host-inapplicable skips` (authoritative).
- [x] Run the post-fix pinned Node 18.18.2 matrix: eight canonical files; `409 passed, 0 failed, 5 host-inapplicable skips` (supporting concurrent run).
- [x] Re-run structural validation (`22/22`), syntax checks, and the terminology scan after the source edits.
- [x] Record the final 42-file release-payload identity, excluding the three self-referential status documents.

### Task 2: Hosted-Windows cleanup failure

- [x] Trace the pre-fix hosted failure in GitHub Actions run `32583592405`: both Ubuntu cells passed; both Windows cells failed with `PROCESS_CLEANUP_FAILED` during the first PowerShell/CIM descendant snapshot.
- [x] Add focused RED/GREEN regressions for transient snapshot failure, persistent failure, helper-deadline handling, and root-PID reuse.
- [x] Add one bounded initial snapshot retry within the existing 5,000 ms cleanup deadline and 3,000 ms helper cap. Only an empty retried identity-less snapshot may proceed; all uncertain ownership paths fail closed before `taskkill`.
- [x] Complete local structural validation and the release-payload manifest refresh.
- [ ] Obtain an authorized post-fix four-cell hosted CI result.

### Task 3: Release evidence and documentation

- [x] Replace stale no-HEAD/no-remote claims with the current base, `origin/main`, release branch, and uncommitted state.
- [x] Create a tracked release-readiness report that separates executed, historical, pending, and authorization-blocked evidence.
- [x] Document the deliberate direction, surface, skill-count, dependency, and version differences from the reference plugin.
- [x] Record remaining gates without claiming release readiness.
- [x] Re-run documentation/structure validation after this update.

### Task 4: Fresh Claude adversarial review

- [x] Record a final pre-review release-payload identity and screen the exact review candidate.
- [x] Correct an empty-range invocation, then run working-tree review `adversarial-review-mt4nd2uy-7ng93d` through `claude-code-advisor:claude`.
- [x] Verify that the review did not mutate source and independently adjudicate its findings.
- [ ] Obtain post-fix hosted Windows evidence; the review did not issue a clean verdict without it.

### Task 5: Installed-plugin verification

- [x] Track the necessary source, tests, handoff, README, plan, and release report in local `main`.
- [ ] Obtain explicit authorization before marketplace/cache/install actions.
- [ ] Validate marketplace/environment read-only; retain `BLOCKED-LOCAL-VALIDATOR` if PyYAML is unavailable.
- [ ] After authorization, install via supported commands, compare source/install hashes, verify fresh root and subagent discovery, and perform one live installed review.

## Current release verdict

Not release-ready. Local post-fix tests, structural checks, source identity, and Claude review execution are complete; the Claude verdict remains blocked on hosted CI, and installed-plugin verification remains authorization-gated.

# Release-readiness status — 2026-08-22

## Verdict

Not release-ready. The local Windows cleanup correction, both post-fix Node matrices, structural checks, and release-payload identity are green, but a fresh Claude review, hosted CI, and installed-plugin checks are still incomplete.

## Executed local evidence

| Gate | Result |
| --- | --- |
| Node 22 matrix | `PASS-EXECUTED-AUTHORITATIVE`: frozen-tree sequential run; eight canonical files; `409 passed, 0 failed, 5 host-inapplicable skips`. |
| Pinned Node 18.18.2 matrix | `PASS-EXECUTED-SUPPORTING`: concurrent frozen-tree run; eight canonical files; `409 passed, 0 failed, 5 host-inapplicable skips`. |
| Windows cleanup TDD closeout | `PASS-EXECUTED`: lifecycle test file; `37 passed, 0 failed, 1 skip`. |
| Windows cleanup contract | One retry only for the initial PowerShell/CIM descendant snapshot, within the existing 5,000 ms overall deadline and 3,000 ms helper cap. A retry may continue only with an empty identity-less snapshot. Non-empty retry results, persistent snapshot failures, helper-deadline failures, and root-PID reappearance fail closed before `taskkill`. |
| Structural and syntax validation | `PASS-EXECUTED`: `22 passed, 0 failed`; all `.mjs` syntax checks passed; terminology scan returned only expected Git `--binary` harness arguments. |
| Release-payload identity | `PASS-EXECUTED`: 42 files, excluding `HANDOFF.md` and the two self-referential status documents. Raw SHA-256 `bd8b838e678a14327d4717d66cb605f4451cab46d791460a5f261953c4529e8e`; Git-blob-manifest SHA-256 `2d7698b74e5d95a288bf55f61cf9c6e828aa611f9bff54f831d386abf238482f`. |

## Historical evidence

- GitHub Actions run `32583592405` was pre-fix. Ubuntu Node 18.18.2 and 22.x passed. Windows Node 18.18.2 and 22.x failed with `PROCESS_CLEANUP_FAILED` in the first PowerShell/CIM snapshot path.
- Earlier full-suite counts, source hashes, and Claude reviews predate the current source/test change. They are historical and cannot support the current release verdict.

## Pending and blocked gates

- `BLOCKED-EVIDENCE`: working-tree review `adversarial-review-mt4nd2uy-7ng93d` completed but did not issue a clean verdict; the retry remains a candidate pending post-fix hosted Windows CI.
- `BLOCKED-AUTHORIZATION`: push local `main` for a fresh four-cell hosted CI matrix.
- `BLOCKED-AUTHORIZATION`: marketplace cache refresh/install, source/install SHA-256 parity, fresh root discovery, fresh subagent discovery, and one live installed review.
- `BLOCKED-LOCAL-VALIDATOR`: the plugin-creator Python ingestion validator cannot run because PyYAML is absent. No dependency installation was performed.

## Repository and scope

The closure is checked into local `main`; use `git rev-parse HEAD` for the exact commit. Remote `origin/main` remains at `721b971ac3077f39b06dd4c6954b532777182bc8` until an authorized push. No push, plugin install, cache mutation, or live installed invocation has occurred.

The product remains intentionally distinct from `codex-plugin-cc`: Codex-to-Claude direction, four skills, a review-only surface, no dependencies, and independent version `0.1.0`.

## Claude review adjudication

- The first invocation, `adversarial-review-mt4nbf7s-zlaf29`, targeted empty `main...HEAD` and is an invocation correction, not a product verdict.
- The corrected working-tree review, `adversarial-review-mt4nd2uy-7ng93d`, challenged the speculative hosted-failure diagnosis. Confirmed: the old hosted log collapses helper failure modes, so only post-fix hosted CI can validate the mitigation.
- Rejected as contradicted by current source/tests: the production helper error-shape claim. The helper maps spawn, timeout, and nonzero-exit failures to `PROCESS_CLEANUP_FAILED`, and the lifecycle suite pins timeout/deadline handling.
- Rejected as a new regression: the first-attempt identity-less snapshot race is a documented pre-existing non-atomic PID limitation; the retry adds stricter checks because it extends the observation window.
- Confirmed evidence concern closed locally: after the concurrent passes, a frozen-tree Node 22 matrix was rerun sequentially and is the authoritative local result.
- Confirmed documentation fixes: restored the deadline/leaked-descendant disclosure and versioned the release status documents with the closure.
- Deferred non-release-blocking cleanup: simplify the transient-reuse test wording, make the post-loop descendant invariant explicit, and improve bounded first-failure diagnostics if hosted CI still fails.

## Reproduction commands

```powershell
npm test
& 'C:\Users\mbk\AppData\Local\npm-cache\_npx\a58f57f9d0f67bf3\node_modules\node\bin\node.exe' scripts\run-tests-sequentially.mjs
npm run validate
```

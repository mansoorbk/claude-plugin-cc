# Claude Skill Responsibility Parity Design

## Goal

Give `claude-plugin-cc` clean-sheet Claude-side counterparts for every skill responsibility exposed by `codex-plugin-cc`, while retaining the existing public `claude-adversarial-review` skill and its foreground, read-only security boundary.

## Evidence-based gap

The reference repository exposes three internal skills:

1. `codex-cli-runtime`: the narrow helper invocation contract.
2. `codex-result-handling`: the output presentation and stop-before-fix contract.
3. `gpt-5-4-prompting`: model-specific prompt composition guidance and references.

The target repository currently exposes only `claude-adversarial-review`. It contains parts of the first two responsibilities inline, but has no independently discoverable internal runtime or result-handling skill and no Claude-specific prompt-composition skill.

## Parity model

Add these clean-sheet counterparts:

| Reference responsibility | Claude-side counterpart | Boundary |
|---|---|---|
| `codex-cli-runtime` | `claude-cli-runtime` | Invoke only the bundled `adversarial-review --json` companion once, in the foreground, from a verified Git cwd. |
| `codex-result-handling` | `claude-result-handling` | Preserve structured findings and evidence labels; stop before fixes; never turn blocked output into substitute analysis. |
| `gpt-5-4-prompting` | `claude-code-prompting` | Convert a review request into a compact scope/focus string without prescribing conclusions or embedding repository evidence. |

The existing `claude-adversarial-review` skill remains the public orchestrator. It routes invocation mechanics to `claude-cli-runtime`, output handling to `claude-result-handling`, and optional focus shaping to `claude-code-prompting`.

## Deliberate non-goals

- Do not copy reference skill text, prompt recipes, or implementation.
- Do not add generic Claude coding, diagnosis, research, rescue, or write-capable task delegation.
- Do not add background jobs, resume, status, result, cancel, model selection, or effort selection.
- Do not call the Claude CLI directly outside the existing companion runtime.
- Do not weaken settings isolation, bounded evidence transport, schema validation, process-tree cleanup, or the stop-before-fix rule.

These exclusions keep the work aligned with this repository's stated product: one bounded adversarial review. They also distinguish skill-responsibility parity from full command and product parity with `codex-plugin-cc`.

## Skill layout

```text
plugins/claude-adversarial-review/skills/
|-- claude-adversarial-review/
|   `-- SKILL.md
|-- claude-cli-runtime/
|   `-- SKILL.md
|-- claude-result-handling/
|   `-- SKILL.md
`-- claude-code-prompting/
    |-- SKILL.md
    `-- references/
        |-- focus-blocks.md
        |-- focus-recipes.md
        `-- focus-antipatterns.md
```

The three new skills are internal (`user-invocable: false`). The public skill remains the only user-facing entrypoint.

## Contracts

### `claude-cli-runtime`

- Accept only the already-verified repository cwd, optional base ref, and optional focus string supplied by the public skill.
- Run the installed plugin's absolute `scripts/claude-companion.mjs` path exactly once.
- Use only `adversarial-review --json [--base <ref>] [focus]`.
- Return stdout unchanged to the calling skill.
- On non-zero exit or malformed output, return the bounded failure and stop; never retry or call `claude` directly.

### `claude-result-handling`

- Preserve verdict, findings, confidence, recommendation, paths, and line numbers.
- Put material findings first and retain the runtime's order.
- Preserve `direct` versus `inference` evidence distinctions.
- Label valid static review evidence `PASS-STATIC`; label unavailable or invalid evidence `BLOCKED`.
- Explicitly state that review output does not prove tests, builds, runtime behavior, or release readiness.
- Stop before edits. Fixes require a separate authorized phase and fresh verification/re-review.

### `claude-code-prompting`

- Produce only an optional focus string for the fixed adversarial-review prompt.
- State the review concern, affected subsystem, and desired risk lens compactly.
- Do not include a suspected answer, expected finding, repository diff, secrets, model flags, tool grants, or instructions to edit.
- Prefer no focus string when the user's request is already precise.
- Keep detailed, conditional examples in the three reference files rather than expanding `SKILL.md`.

## Verification strategy

1. Add a failing inventory test proving the target lacks the three counterparts.
2. Add the minimal skill entrypoints and Claude-specific references.
3. Validate every skill with the bundled `skill-creator` validator.
4. Run repository structural and full runtime tests on Node 18.18 and the current Node version.
5. Forward-test realistic root-agent and spawned-subagent review requests in isolated synthetic repositories.
6. Validate the source plugin, refresh the installed plugin through the supported cachebuster flow, prove source/install hash parity, and verify skill discovery in a new Codex task.
7. Run a fresh installed Claude adversarial review; report a timeout or unavailable Claude session as `BLOCKED`, not as a pass.

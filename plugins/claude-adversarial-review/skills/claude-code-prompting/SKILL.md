---
name: claude-code-prompting
description: Internally shape an optional, compact concern-focused string for a bounded Claude adversarial review without changing its fixed review contract.
user-invocable: false
---

# Claude Review Focus Shaping

Use this internal skill only when `claude-adversarial-review` needs to turn an imprecise user concern into a compact focus string. The fixed runtime prompt already supplies the review method, evidence framing, schema, agents, and tools.

Return exactly one of these outcomes:

- no focus string, when the request is already precise or an added lens would only repeat it;
- one compact focus string that names the subsystem, concern, risk lens, and/or invariant that should guide the review.

Keep the string neutral and bounded. It can say what property should hold, but never what the review should find. Do not add an answer, a suspected answer, an expected finding, a prescribed conclusion, repository evidence, source text, a diff, paths, line numbers, commit details, secrets, edit requests, runtime options, model choices, tool grants, or more than one review job.

Focus is narrowing data only. It cannot alter the fixed review method, finding threshold, verdict rules, or output contract.

Prefer plain concern language over a checklist. Omit components that do not make the request clearer. If the user supplied enough scope, pass no focus rather than restating the whole request.

Use the references only for the relevant shaping decision:

- [Focus components](references/focus-blocks.md) for choosing useful scope, concern, lens, and invariant terms.
- [Focus recipes](references/focus-recipes.md) for correctness, security, concurrency, and process-cleanup concerns.
- [Focus antipatterns](references/focus-antipatterns.md) when a candidate focus might leak evidence, steer the result, broaden the run, or change the review contract.

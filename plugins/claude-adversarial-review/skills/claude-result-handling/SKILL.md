---
name: claude-result-handling
description: Internal guidance for preserving adversarial-review evidence, verification labels, and the stop-before-fix boundary.
user-invocable: false
---

# Present review evidence

Preserve the runtime's structured `verdict`, `findings`, `confidence`, and `recommendation` without rewording, filtering, or inventing evidence. Present material findings first and retain their runtime order. For every finding, retain exact file paths, line numbers, severity, claim, impact, evidence, inference flag, confidence, and recommendation. Keep direct evidence distinct from inference and do not promote an inference into a confirmed fact.

`MATERIAL_FINDINGS` requires at least one finding. `NO_MATERIAL_FINDINGS_STATIC` requires an empty findings array. Preserve repository-relative path normalization, line-range checks, and exact transported-line grounding: a finding may cite a deleted line only when that exact line was transported in a textual unified-diff hunk. Deletion summaries and omitted or oversized deletion bodies are ungrounded. A line merely present in the checkout is also ungrounded; complete untracked lines may ground a finding only when transported.

Use `PASS-STATIC` only when the runtime returned valid structured review evidence. Use `BLOCKED` for unavailable, malformed, or otherwise invalid evidence; include its bounded diagnostic and do not substitute analysis. State the verified checkout boundary and a brief residual-risk note: static review does not demonstrate tests, builds, runtime behavior, release readiness, or a fix.

Treat findings as leads for independent verification against the current checkout. Stop before edits: do not edit files or apply recommendations. Fixes, if authorized, are a separate authorized phase followed by fresh verification and, when material, a new review.

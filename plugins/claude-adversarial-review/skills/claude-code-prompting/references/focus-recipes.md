# Focus Recipes

Use these as patterns for choosing neutral review attention. Each produces one compact string, not a task plan or a claim about the code.

## Correctness

Use when behavior must preserve a business or data-flow property across ordinary and failure paths.

```text
queue delivery lifecycle — correctness: preserve requested delivery state across partial completion and retry
```

Keep the invariant measurable and avoid naming the alleged defect.

## Security

Use when trust boundaries, authorization, token handling, or data exposure deserve closer inspection.

```text
account recovery boundary — security: reject access that is not bound to the intended account and workspace
```

Name the boundary and the required separation; do not supply attack evidence or assert an exploit exists.

## Concurrency

Use when overlapping work, stale state, deduplication, ordering, or retries could violate a shared-state property.

```text
subscription reconciliation — concurrency: overlapping requests must not replace unrelated active subscriptions
```

Focus on the required outcome, not a particular synchronization mechanism.

## Process Cleanup

Use when process ownership, cancellation, timeout handling, or child-process cleanup is material.

```text
review runner lifecycle — process cleanup: completion, failure, and timeout leave no owned child work running
```

This asks for lifecycle safety without directing a remediation.

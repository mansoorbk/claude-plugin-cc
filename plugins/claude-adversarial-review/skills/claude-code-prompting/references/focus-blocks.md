# Focus Components

A focus string is optional steering for a fixed adversarial review. Select only the parts that remove a real ambiguity, then express them in one compact sentence or phrase.

## Subsystem

Name the feature area or boundary under review when it narrows attention without adding implementation detail. Examples: `session recovery flow`, `request authorization boundary`, or `background delivery lifecycle`.

## Concern

State the failure class to inspect. Favor a noun phrase such as `authorization bypass`, `state loss during retry`, `incorrect result aggregation`, or `orphaned child process`.

## Risk lens

Add the kind of risk that makes the concern important: `security`, `correctness`, `concurrency`, `reliability`, or `process cleanup`. A lens is useful when the same subsystem could be reviewed several ways.

## Invariant

Express a property that must remain true without assuming whether it currently fails. Good invariants are observable in principle: `each workspace boundary remains isolated`, `a retry cannot duplicate externally visible work`, or `forced cleanup leaves no owned process in its group or observed descendant lineage`.

## Assembly

Use the smallest useful combination:

```text
<subsystem> — <risk lens>: <concern>; preserve <invariant>
```

Drop labels or clauses that make the string repetitive. Do not add file locations, excerpts, historical outcomes, or a predicted defect.

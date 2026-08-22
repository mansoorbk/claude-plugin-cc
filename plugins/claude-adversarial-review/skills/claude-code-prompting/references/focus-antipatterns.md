# Focus Antipatterns

Reject a candidate focus when it changes the review question into a conclusion, a transport channel, or a second workflow. Use no focus if a safe compact replacement is not available.

## Answer-prescribing

Do not assert the defect, identify a culprit, or demand a verdict. Replace a conclusion with the relevant concern and invariant.

## Evidence-embedding

Do not include repository evidence such as file paths, line ranges, source excerpts, patch summaries, commit identifiers, test output, or prior findings. The fixed review runtime owns evidence collection and framing.

## Secret-bearing content

Do not place credentials, tokens, connection details, private identifiers, or other sensitive values in focus. Reduce the request to the affected boundary or concern.

## Broad scope

Avoid catchalls such as every service, every security risk, or a full audit. Select one subsystem and concern, or leave focus absent when the request itself supplies the proper boundary.

## Edit requests

Do not ask the reviewer to change, repair, refactor, stage, or commit anything. This skill prepares static-review attention only.

## Flags and execution controls

Do not add command-line flags, model selection, tool permissions, runtime settings, timeouts, or other execution controls. The fixed review path owns those constraints.

## Multi-job requests

Do not turn separate concerns into multiple review runs, retries, follow-ups, or background work. Choose one compact concern or no focus.

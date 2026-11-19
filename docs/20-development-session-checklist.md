# Development Session Checklist

[Back to index](./README.md)

Use this reference at the start and end of every video-editor development session.
Check every category, but update only material affected by the work. "Reviewed,
no change needed" is valid; unnecessary rewrites and repeated full reviews are not.
This is a human/assistant workflow, not an automated enforcement mechanism.

## 1. Start the session

- [ ] Read this checklist and the relevant [milestone](./09-milestones.md).
  Consult the [system status](./16-review-plan-and-system-status.md) or
  [QA/fix readiness](./17-qa-and-fix-readiness.md) only for the affected area.
- [ ] Confirm the next bounded outcome, acceptance criteria and deferred work.
  Distinguish implemented features from planned work and manual acceptance.
- [ ] Inspect the video-editor worktree before editing. Preserve existing changes;
  do not clean, commit or modify other projects without agreement.
- [ ] Apply the owner's credit budget: focused searches and affected checks first.
  Ask before full test suites, CI monitoring, subagents or broad investigations.
  Reuse recent evidence; do not repeat a full review just to resume work.
- [ ] At the next development pass, load **Development: unknown-error follow-ups**
  in the editor. Review pending local tasks, prioritize relevant/repeated causes,
  and agree scope before investigating unrelated records. A failed inbox load is
  not an empty inbox. Honor an explicit owner deferral in the milestone priorities:
  preserve recording/records, address active blockers and defer the dedicated review.

## 2. Implement and maintain the related surfaces

| Review every session | Update when affected | Source of truth |
|---|---|---|
| Plan and status | Record delivered work, remaining limitations and acceptance state; do not mark a whole milestone complete based on one slice | [Milestones](./09-milestones.md); [system status](./16-review-plan-and-system-status.md) for affected findings |
| Technical documentation | Reflect changed schemas, commands, persistence, UI or media behavior in the relevant existing document; add a new document only for a distinct reference | [Documentation index](./README.md) |
| In-app Help | Update task instructions, actual feature availability and limitations when user-visible behavior changes; keep About/version information truthful | [helpContent.ts](../apps/client/src/helpContent.ts), [Help behavior](./19-in-app-help.md) |
| Error definitions and recovery | Review new/changed failure paths, readable cause/impact/action, stage/outcome/operation matching and safe buttons | [Executable catalog](../packages/schema/src/errorCatalog.ts), [catalog reference](./18-error-catalog-and-recovery.md) |
| Animation catalog | When presets change, maintain stable IDs/versions, descriptions/defaults, shared preview/export behavior, saved-project compatibility and Help's live catalog | [Shared animation catalog](../packages/schema/src/animations.ts), [timing contract](./05-preview-and-export.md#entranceexit-animation-catalog) |
| Unknown-error tasks | Investigate with evidence, add precise definitions and regressions, verify recovery, then resolve only the matching fingerprint | [Unknown-error lifecycle](./18-error-catalog-and-recovery.md#unknown-error-inbox-and-development-tasks) |
| Manual testing | Add reproducible steps and expected results for changed behavior; state what still needs desktop acceptance | [Run and manual guide](./13-run-and-manual-testing.md) |
| Workflow itself | Add a genuinely recurring maintenance obligation here when discovered; do not copy feature-specific task lists into this checklist | This document |

Important invariants:

- Help's error tab reads the executable catalog. Update that shared definition and
  its documentation/tests rather than creating a separate list of error messages.
- Do not add a generic catalog entry solely to suppress unknown-error records.
  Unknown envelopes are not diagnoses; retain the temporary investigation task.
- Never erase tasks merely because a definition now exists. Add an exact entry to
  `VERIFIED_ERROR_RESOLUTIONS` only after investigation, a regression and verification.
  The existing inbox then removes matching verified/catalogued records.
- Never put raw error messages, file paths, tokens, private footage or project
  contents into the unknown inbox or shared reports. Keep raw diagnostic details
  local and share only redacted evidence.
- A timeout is not proof of failure. Preserve receipt checks, project ownership,
  duplicate guards and explicit review; clearer wording must not weaken safety.
- No documentation or Help content change is required when the category is
  genuinely unaffected, but record that it was reviewed in the session handoff.

## 3. Validate proportionately

- [ ] Add/update focused regressions for changed behavior, including the relevant
  failure/recovery path. Use isolated synthetic projects, never user work for faults.
- [ ] Run the smallest related test selection, affected typechecks/lint and build
  when applicable. Documentation-only changes need no application build or tests
  unless a documentation-specific check covers them.
- [ ] Separate passing automation from manual acceptance. Report failed checks,
  skipped cases and untested behavior honestly; do not claim full-suite success.
- [ ] After several feature changes since the last full gate, propose running the
  full JavaScript gate at handoff; run it only with owner approval.
- [ ] If engine/desktop runtime changed, explain the relaunch requirement.
  Relaunch only when requested, using the owned-process launcher in the
  [run guide](./13-run-and-manual-testing.md); verify responsiveness.
- [ ] Provide short user test steps with expected results. Do not ask the owner to
  force crashes, revoke permissions or kill processes on a real project.

## 4. Close the session

- [ ] Review the affected diff and ensure no unrelated changes were introduced.
  Preserve earlier work and clean up only temporary files/processes created for
  this task. Leave the app running if the owner requested it for testing.
- [ ] Confirm the documentation, Help, catalog, follow-up tasks and manual-guide
  categories above are updated or explicitly not applicable.
- [ ] Summarize delivered behavior, exact focused evidence, known limitations,
  outstanding manual acceptance, relaunch status and the next planned slice.
- [ ] Do not commit, publish, clear unresolved tasks or run broader checks without
  the required owner approval.

Use this compact handoff format in chat; do not create a new tracking document
for every session:

```text
Delivered:
Docs / Help / catalog: updated or reviewed-no-change, with reason
Unknown-error follow-ups: reviewed / resolved fingerprints / deferred / not loaded
Checks: passed, failed, skipped or not run
Manual acceptance and relaunch:
Known limitations and next step:
```

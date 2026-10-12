# 17. QA and Fix Readiness

[Back to index](./README.md)

This is the evidence-based reference for diagnosing an issue, assessing a fix before implementation, and verifying the outcome. Use it alongside the subsystem perspectives in the [Review Plan](./16-review-plan-and-system-status.md). The [Known issues backlog](./10-future-features.md) owns issue IDs, priority, status and acceptance gates; do not create a second issue inventory here.

The senior QA and senior engineering perspectives are complementary reasoning lenses, not claims of credentials or independent sign-off. One reviewer can apply both. Agreement between role labels is not evidence.

## Scope and authority

- Apply this workflow to each proposed fix or tightly coupled group of issues. A small fix can use a short assessment, but still needs a contract, evidence, risk check and acceptance result.
- First read the listed issues, relevant subsystem notes, [product scope](./01-overview-and-scope.md), current implementation and affected callers. Do not silently replace the agreed requirement with the behavior easiest to implement.
- Proceed only inside user-approved scope. Discovering an issue or agreeing on a fix does not authorize unrelated changes, milestone expansion, commits or publication.
- Preserve user projects, media, logs and unrelated processes. Reproductions must use owned test fixtures and isolated state.
- Distinguish current defects, coverage gaps and future risks. A future risk is not automatically a reproduced bug.

## 1. Establish the baseline

Record the issue ID(s), affected subsystem(s), date, commit and relevant working-tree changes. Include the platform, versions, configuration and prerequisites needed to reproduce the behavior; avoid recording credentials or private media.

Identify the applicable implemented contract and any target-only design. Note existing tests, known coverage limits and user approval boundaries. An old green test run does not verify newly changed code.

## 2. Senior QA assessment: define the problem and proof

Reason from the user's workflow and observable outcomes, including failure and recovery paths.

| Field | Required content |
|---|---|
| Contract | Expected behavior and its source; explicitly flag assumptions or missing requirements |
| Actual behavior | What happens instead, including visible UI, error code, persisted state and background work where relevant |
| Reproduction | Minimal steps, inputs, prerequisites, frequency and timing conditions; distinguish attempted from successful reproduction |
| Impact | Who is affected, blocked workflow, data/storage consequences and available workaround |
| Severity | Consequence of the failure, assessed separately from scheduling priority |
| Evidence | Relevant source locations, test/assertion or observed result, confidence and limits |
| Acceptance | Measurable pass/fail outcomes for the original failure, recovery path and behavior that must remain unchanged |

### Severity versus priority

Use these QA severity terms consistently; they are not a security-audit classification.

- **Critical:** demonstrated irreversible user-data loss or destructive effects beyond owned project/job state.
- **High:** core editing/save/export is broken, wrong project/job is affected, or user data is at substantial risk.
- **Medium:** recoverable workflow failure, misleading result or user-visible error without adequate recovery.
- **Low:** limited usability, accessibility or maintenance impact with no demonstrated higher consequence.

Assess context rather than assigning severity from a code pattern alone. Use the backlog's P1/P2/P3 rules for priority. Dependencies, affected users and milestone gates influence scheduling; a low-impact issue may still be a prerequisite. Mark unverified severity as provisional.

### QA acceptance checklist

- The original reproduction fails before the fix when a maintained regression can demonstrate it, and passes afterward.
- Rejected operations leave the correct in-memory and persisted state unchanged.
- Successful operations return the required result shape and visible user outcome.
- Relevant cancellation, retry, project switch/reopen, concurrency and cleanup boundaries are covered.
- Errors are actionable: code/message, recovery or retry path, and appropriate diagnostic evidence. No silent or success-shaped fallback.
- Existing intended behavior remains supported, including frame/time rules and preview versus export distinctions.
- UI claims use component or manual interaction evidence, not only API/helper tests.

Select the relevant checks; document why material checks are deferred rather than claiming all cases passed.

## 3. Senior engineering assessment: verify the cause and plan

Read the QA record before designing the fix. Trace the failure to its originating state transition or contract boundary rather than patching the last visible symptom.

| Field | Required content |
|---|---|
| Root cause | Verified causal explanation and evidence; competing hypotheses if not yet resolved |
| Affected surfaces | Callers, shared schemas/helpers, client/API, jobs, persistence, diagnostics and directly related docs |
| Ownership and commit point | Who owns asynchronous work, files and state; where an operation becomes authoritative |
| Proposed fix | Simplest complete correction, reuse of existing patterns and explicitly excluded work |
| Alternatives | Material alternatives and why rejected; omit speculative redesigns with no relevant benefit |
| Risks | Compatibility, data format, lifecycle, performance and UX consequences |
| Recovery | How failure is surfaced, partial state is handled and the change can be rolled back without losing user data |
| Validation | Regression selectors, failure injection, unchanged-behavior checks and required manual acceptance |

Do not equate a typed API or shape-valid object with a valid end-to-end operation. Check relational invariants, state ownership, failure cleanup and user-visible consequences where relevant.

If the root cause is uncertain, collect narrower evidence first. Do not use broad catches, silent defaults or weakened validation to make the reproduction disappear.

## 4. Reconcile QA and engineering before editing

Compare each acceptance condition against the proposed implementation and validation. Record a short reconciliation table in the issue assessment:

| Contract / acceptance condition | QA evidence | Engineering response and test | Agreement / unresolved point |
|---|---|---|---|
| Specific required outcome | Reproduction or source evidence | How the fix preserves it and how it will be checked | Agreed, investigate or user decision |

Resolve disagreements according to their nature:

| Type | Action |
|---|---|
| Factual: disputed reproduction, root cause or state outcome | Investigate with source, tests or runtime evidence; do not ask the user to choose between unsupported claims |
| Technical: different implementations preserve the same agreed contract | Choose the simplest reliable approach and document material reasoning |
| Product/risk: different UX semantics, compatibility guarantees, data deletion/migration or acceptance changes | Pause the affected fix and present the choices, consequences and recommendation to the user |
| Scope: the fix needs broader features or unrelated changes | Explain the dependency and obtain scope approval before expanding |

### Gate result

- **Proceed:** scope is approved, the cause is sufficiently evidenced, acceptance and fix agree, and material risks have a validation/recovery plan.
- **Investigate:** evidence or reproduction is insufficient, or a factual disagreement remains. Name the next bounded check.
- **User decision required:** a behavior, data, compatibility or scope trade-off remains. State the exact decision and affected acceptance criteria; do not implement the disputed behavior first.

Approval of one choice does not authorize unrelated fixes. Work on independent, already approved items can continue while a disputed item remains blocked.

## 5. Implement and perform post-fix QA

1. Make the bounded correction and regression tests; preserve unrelated changes.
2. Run the smallest existing validation covering the changed behavior. Escalate when targeted results reveal wider coupling.
3. Retest the original condition and each agreed acceptance criterion. Check actual output/state and cleanup, not just runner exit status.
4. Reconcile any new behavior or failed acceptance with the pre-fix agreement. Reopen investigation or obtain a decision rather than weakening a test to fit the implementation.
5. Update the authoritative backlog and directly related documentation. Record commands, results, skipped checks, workarounds and remaining limitations.
6. State the outcome precisely: `fix implemented / unverified`, `verified locally`, `verified in hosted CI`, or `deferred with reason`. Keep local and hosted evidence distinct; neither substitutes for unperformed manual acceptance.

Regression tests stay with the code. Keep concise issue findings and durable decisions with the existing backlog; use the review plan's evidence ledger for shared validation runs. Do not paste raw logs or duplicate the full backlog into this reference.

## Reusable assessment template

Use this compact template in a review or pre-fix response. Link it to the existing issue ID; do not create a separate Markdown report for every issue by default.

```text
Issue / subsystem / approved scope:
Baseline / environment / prerequisites:

QA
Expected / actual:
Reproduction / evidence / confidence / limits:
Impact / severity / priority / workaround:
Acceptance criteria:

Engineering
Verified cause / remaining hypotheses:
Affected surfaces / ownership / commit point:
Proposed fix / exclusions / material alternatives:
Compatibility and data risks / failure recovery / rollback:
Validation plan:

Reconciliation
Acceptance -> fix -> test:
Agreements / unresolved points:
Gate: proceed | investigate | user decision required
Required decision and consequences, if any:

Post-fix QA
Original reproduction / regression results:
Acceptance and unchanged-behavior results:
Deferred checks / remaining risks:
Backlog and documentation updates / verification status:
```

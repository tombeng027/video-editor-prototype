# Error Catalog and Recovery

[Back to index](./README.md)

## Approved priority

Improve edit/save recovery before animations and transitions. First deliver a shared
context-aware catalog, understandable recovery actions, and a temporary local inbox
for uncatalogued errors. Import, preview and export adoption are implemented.
Do not weaken the existing protection against duplicate edits to simplify the UI.

## Message contract

Every notice explains what happened, whether the edit was applied (only when
confirmed), why editing may be paused, and the next safe action. Technical codes
and diagnostic references belong under Details, not in the primary explanation.

Definitions match code, recovery stage and outcome, with operation-specific
guidance where needed. Generic fallback text does not count as a catalog match.
The executable catalog is the source of truth; tests keep this document's
definition index aligned with it.

- A rejected edit: explain the cause, say it was not applied, and keep editing available.
- A confirmed save failure: explain that it was not applied and offer the existing safe retry.
- A lost/invalid response: do not infer success or failure. Check the original attempt.
- An unknown attempt: load the saved project for review; never automatically resend.
- After loading for review: explain that Undo/Redo was cleared; explicitly confirm
  the last edit's presence or absence before continuing.

## Unknown-error inbox and development tasks

Only errors without a matching definition enter this temporary inbox. Each grouped
record is also a pending local development task: investigate, add a definition and
focused regression test, verify recovery guidance, then remove the matching record.
This is not a GitHub issue or a session-only task that disappears when chat ends.

Store only validated code/context, operation category, application version,
timestamps, repeat count and optional diagnostic UUID. Never store raw error text,
paths, project/asset names or IDs, request bodies, tokens, media or stacks.
No automatic upload. Existing bounded engine diagnostics remain separate.

Known definitions alone must not silently erase unresolved tasks. Cleanup requires
an explicit verified-resolution entry matching the fingerprint. Bound storage and
surface recording/read/write failures; a logging failure must never unlock an edit.

## Delivery checks

- Catalog matches and fallback text respect confirmed versus unknown outcomes.
- Repeated unknowns group into one task; known errors do not create inbox entries.
- Entries survive application restart; task/report data contains no private payloads.
- Only verified matching resolutions remove records, not generic fallback coverage.
- Lost responses, unavailable status, different-project responses and failed
  reconciliation keep mutations locked; explicit review remains required.
- Ordinary confirmed rejections do not enter uncertainty recovery.

## Definition index

Source: [executable catalog](../packages/schema/src/errorCatalog.ts). The primary
message combines the definition's cause/next action with a confirmed or uncertain
impact statement and the operation label (for example, "changing clip speed").
Each table row represents separate definitions when multiple codes are listed.

| Code | Confirmed rejection guidance |
|---|---|
| `TRACK_LOCKED` | Unlock the track to edit it. |
| `INVALID_SPEED` | Forward 0.25x..4x on video/audio; still images remain 1x. Applies to speed, batch edit or history operations. |
| `INVALID_TRANSFORM` | Choose a visual clip and bounded position, zoom and opacity. |
| `INVALID_ANIMATION` | Visual clips only, listed IDs/version 1 and at least two project frames per effect. Shorten/remove effects before trim/split/speed edits that leave insufficient duration; split keeps entrance left and exit right. |
| `INVALID_ZOOM` | Visual clips only, version 1, start point before end point and scales 25–400%. Move the points apart or choose supported scales. |
| `INVALID_VOLUME` | Clip volume must be 0–100%. Choose a value in range or reset to 100%. |
| `INVALID_CROP` | Visual clips only; each source-relative inset is 0–90%, with opposing inset sums below 95%. Reduce the insets in Properties > Crop or use Reset crop. Preview and export share the saved crop. |
| `INVALID_CAPTION` | One nonoverlapping caption lane, nonblank text up to 2000 characters, safe integer start/end project frames with start before exclusive end. Shorten text, correct timing or move/trim away from neighbors. Foundation commands only; no caption UI yet. |
| `UNSUPPORTED_PROJECT_VERSION` | Use a compatible app version. Do not overwrite the project or recover an older backup over unsupported-version data. Open rejection unlocks normal project navigation rather than treating the result as uncertain. |
| `INVALID_CANVAS_SIZE` | Canvas width and height must be positive whole pixel dimensions. Choose a supported Preview aspect preset. Malformed API payloads fail schema validation as `INVALID_REQUEST`. |
| `INVALID_AUDIO_SPLIT` | Split audio needs a video clip with sound on a visual track, not already split, and an audio target track. The toolbar disables Split audio otherwise. |
| `INVALID_RANGE` | Keep valid source bounds and timeline positions. |
| `INVALID_FRAME` | Split inside the clip at a nearby whole-frame-compatible boundary. |
| `OVERLAP` | Choose another position/track or shorten the clip. |
| `NOT_FOUND` | Check the timeline and select the missing item again. |
| `TRACK_KIND_MISMATCH` | Choose a compatible audio/visual track. |
| `DUPLICATE_ID` | Inspect the existing item; restart if it repeats. |
| `DUPLICATE_ORDER` | Inspect the changed track layout before retrying. |
| `INVALID_TRACK_ORDER` | Choose different compatible tracks. |
| `INVALID_TRACK_NAME` | Enter a non-empty name of at most 80 characters. |
| `ASSET_IN_USE` | Remove the asset's timeline clips before removing the asset. |
| `TRACK_NOT_EMPTY` | Move/remove the clips before removing the track. |
| `PROJECT_NOT_EMPTY` | Keep the current frame rate or use an empty project. |
| `RELINK_INVALID_FILE` | Choose a readable original source file. |
| `RELINK_MISMATCH` | Locate the matching original, not another encode/edit. |
| `SAVE_FAILED` | Check free space and folder permissions; Retry edit is safe only after confirmed failure. |
| `SAVE_CLEANUP_FAILED` | Check folder permissions/file locks; retry only after confirmed failure. |
| `INVALID_REQUEST` | Request rejected before application; editor/engine may be out of sync. Restart after an update, copy details if repeated. |
| `NO_PROJECT` | Reopen the intended project. |
| `PROJECT_CHANGED` | Open the intended project before editing. |
| `COMMAND_OPERATION_BUSY` | Wait for existing operations to settle. |

These match submit/status plus **not-applied** only. The same code with uncertain
outcome does not inherit the rejection's "nothing applied" assertion.

| Code | Unconfirmed-result guidance (submit/status/review-load stages) |
|---|---|
| `REQUEST_TIMEOUT` | Saving may still be running; check the original edit's receipt. |
| `UNREACHABLE` | Connection lost; check when the engine becomes available. |
| `BAD_RESPONSE` | Reply unreadable, not proof of failure; check receipt, consider restarting after updates. |
| `OPERATION_UNKNOWN` | Receipt expired/missing; load the saved project for review. |
| `PROJECT_CHANGED` | Confirm the intended project; do not adopt a different project. |
| `NO_PROJECT` | Engine has no active project against which to verify the edit. |
| `ATTEMPT_EXISTS` | Check the original receipt instead of resubmitting. |

`UNAUTHORIZED` and `FORBIDDEN_ORIGIN` explain connection/access problems at all
three stages and both outcomes. They never advise sharing an engine access token.
The outcome-specific impact statement still determines whether changes are paused.

Generic `ENGINE_UNEXPECTED_ERROR`, unknown HTTP failures and newly introduced
codes deliberately remain uncatalogued: an envelope is not a root-cause definition.

### Fallback templates

Import definitions are scoped to the `import` operation and never reuse timeline
edit explanations. File notices apply only to that file; batch summaries state
how many files were added and failed. Successfully imported files should not be
selected again when retrying failures.

| Import code | Cause and safe guidance |
|---|---|
| `MEDIA_PICK_FAILED` | File chooser failed before submission; choose again or cancel. |
| `INVALID_REQUEST` | Choose 1-50 full media paths in a supported mode. |
| `IMPORT_OPERATION_BUSY` | A different import is settling; wait for its result. |
| `UNSUPPORTED` | No usable supported media data found; convert a copy if needed. |
| `PROBE_FAILED` | Metadata unreadable; check playback/access and FFmpeg availability. |
| `ALREADY_IMPORTED` | Use the existing asset instead of importing another copy. |
| `INVALID_MEDIA_PATH` | Supply an absolute path to a file, not a folder. |
| `FILE_NOT_FOUND` | Reconnect/locate the missing source file. |
| `FILE_ACCESS_DENIED` | Check source and project-folder permissions/file locks. |
| `IMPORT_CLEANUP_FAILED` | Failed import registered no assets, but copied files may remain; review the media folder without deleting existing assets. Applies only to a confirmed failed receipt. |
| `REQUEST_TIMEOUT`, `UNREACHABLE`, `BAD_RESPONSE` | Outcome is uncertain; check the original receipt, do not resend. |
| `IMPORT_RECEIPT_MISSING` | Receipt expired/missing, not proof of failure; load Assets for review. |
| `ATTEMPT_EXISTS` | Check the original attempt instead of submitting it again. |
| `PROJECT_CHANGED`, `NO_PROJECT` | Verify the intended project before proceeding; unconfirmed results remain locked. |
| `UNAUTHORIZED`, `FORBIDDEN_ORIGIN` | Use the desktop connection; never share its token. |

Generic `IMPORT_FAILED` and `IMPORT_OUTCOME_UNKNOWN` remain uncatalogued envelopes,
not diagnoses. File failures use a not-added fallback specific to that file;
unconfirmed batch failures explain that the import result is unknown. Both
create sanitized temporary tasks, without persisting file paths or raw details.

Edit/save fallback templates:

- Confirmed rejected: **This edit could not be applied**. "An unexpected problem
  occurred while [operation]. The edit was not applied. Your previously saved
  project remains available. Review the timeline before trying again."
- Unconfirmed: **We could not confirm your last edit**. "An unexpected problem
  occurred while [operation]. We do not yet know whether this edit was saved.
  Editing and project navigation are paused to prevent duplicate changes.
  Check whether the edit saved; do not submit it again."

### Current implementation

#### Export

Export operations distinguish `export-start`, `export-status`, `export-cancel`
and `export` (background render, `job` stage). Confirmed rejected starts use
`not-applied` to mean no new render started, not that timeline edits failed.
`unconfirmed` means the render or cancellation may still be running. `failed`
means no verified finished output is available; leftovers are not proof of success.

| Export code | Cause and next action |
|---|---|
| `EMPTY_TIMELINE` | Add a visual timeline clip before exporting. |
| `OFFLINE_MEDIA` | Export requires originals; restore/relink used source files, not proxies. |
| `TOO_MANY_CUTS` | Prototype command-line size limit; simplify a project copy, keeping the original. |
| `MISSING_ASSET` | Timeline references absent project media; inspect clips and keep a backup. |
| `EXPORT_BUSY` | New request rejected while another render settles; explicitly Check active export. |
| `EXPORT_CANCELLED` | Cancellation interrupted initial checks; confirm the intended project before a new request. |
| `INVALID_REQUEST` | Invalid start attempt; reopen Export, relaunch after updates if repeated. |
| `INVALID_EXPORT_SETTINGS` | Unsupported format/rate/resolution/quality rejected before rendering; choose listed presets, reopen Export or relaunch after an update if repeated. |
| `NO_PROJECT`, `PROJECT_CHANGED` | Project absent/changed during preflight; verify intended project. |
| `REQUEST_TIMEOUT`, `UNREACHABLE`, `BAD_RESPONSE` | Export may still run; check status rather than duplicate start/cancel. |
| `EXPORT_START_UNCONFIRMED` | Idle, missing or different attempt identity; no result adopted. Keep checking; confirm old engine stopped before reloading after restart. |
| `UNAUTHORIZED`, `FORBIDDEN_ORIGIN` | Use desktop connection; never share token or infer render stopped. |
| `EXPORT_CLEANUP_FAILED` | Partial/unverified output cleanup failed; inspect disk, permissions, locks and diagnostic reference. Keep originals and do not trust leftover output. |
| `EXPORT_DURATION_MISMATCH` | Rendered duration outside existing tolerance; output rejected and cleanup attempted. Investigate timing with a short isolated project. |
| `EXPORT_SETTINGS_MISMATCH` | ffprobe found a different codec, size or frame rate; unverified output rejected and cleanup attempted. Keep originals and report selected settings with the diagnostic reference. |

`EXPORT_FAILED`, generic HTTP/engine errors and new codes remain uncatalogued
unless the actual cause is known. Raw FFmpeg text is kept under collapsed Error
details, never substring-classified or persisted in the temporary inbox.
Shared recovery-notice recording is reused by preview/export; unknown tasks contain
only allowlisted context, counts/timestamps/version and an optional diagnostic UUID.
No existing task is marked resolved solely by delivering this slice.

The start rejection allowlist includes validated settings rejection. All successful initial,
polled and cancellation responses must identify the current attempt and be non-idle
before adoption. A wrong/absent receipt cannot unlock Close or show a stale success.
After a lost cancellation reply, another cancellation stays disabled until a matching
status succeeds. Failed progress reads retain last-confirmed progress and pause
polling until **Retry status check**; no automatic render/cancel resend occurs.
The existing revision guard still discards pre-cancel polls and unmounted responses.

**Check active export** is offered only after a busy rejection. It explicitly
inspects the earlier engine job without starting another render; successful
adoption then uses that earlier job's identity. Failed inspection stays retryable.
Resolved output settings are frozen on the attempt and returned with progress and
terminal status. The summary uses that receipt, never another job's form draft.
Options freeze/collapse during active or unconfirmed work; edits after settlement
apply only to the next explicit start. Reopening the dialog resets defaults.
Cancellation acknowledgement while running means wait for cleanup, not safe closure.
`done` can legitimately win a cancellation race; show that verified result.
Closing after confirmed failure does not alter project edits or original media.

Relaunch is required for engine/schema updates, including export settings validation
and output verification. The owner reported the recovery walkthrough looks good;
desktop acceptance of selectable export settings remains separate from automation.

#### Preview

Preview contexts distinguish `preview`, `preview-prepare`, `preview-cancel` and
`preview-status` operations. `playback` and `job` stages identify local player
failures and background preparation results. The `unavailable` outcome describes
playback/status availability, not whether a timeline mutation was applied.
Submission errors use `unconfirmed` conservatively: the prepare/cancel request may
have arrived. New job requests stay disabled until a fresh authoritative proxy
snapshot succeeds; refreshing does not resend the job. Timeline edit/save locks
and export eligibility are not replaced by this preview-specific gate.

| Preview code | Cause and next action |
|---|---|
| `PREVIEW_OFFLINE` | Original unavailable; reconnect/refresh or Relink in Assets. |
| `PREVIEW_READY_TIMEOUT` | No decoded initial video frame within five seconds; explicit retry, then Play, or optional optimization for original video. Not proof of corruption. |
| `PREVIEW_PLAY_BLOCKED` | Player rejected playback permission; retry, then use an explicit Play gesture. |
| `PREVIEW_UNSUPPORTED` | Player reported unsupported media; optimize original video, or check a compatible source for audio/already optimized video. |
| `PREVIEW_NETWORK_FAILED` | Browser media error 2; check engine/file access and refresh. |
| `PREVIEW_DECODE_FAILED` | Browser media error 3; player decoding failure, not a save failure. |
| `PREVIEW_ABORTED` | Browser media error 1 or AbortError; explicit playback retry. |
| `PREVIEW_IMAGE_FAILED` | Image load failed; refresh status/check original image. Does not guess the underlying cause. |
| `PROBE_FAILED`, `UNSUPPORTED` | Preparation rejected unreadable original or unsuitable video asset; relink/check permissions or choose a video. |
| `PROJECT_CHANGED`, `NO_PROJECT`, `NOT_FOUND` | Verify intended project/asset before another preview request. |
| `REQUEST_TIMEOUT`, `UNREACHABLE`, `BAD_RESPONSE` | Latest state unconfirmed; refresh before another prepare/cancel request. |
| `UNAUTHORIZED`, `FORBIDDEN_ORIGIN` | Use desktop connection, never share its token. |
| `PREVIEW_EVENTS_UNAVAILABLE` | Live updates unsupported; refresh snapshots manually. |
| `PREVIEW_EVENTS_DISCONNECTED` | Stream interrupted; snapshot reconciliation is attempted without restarting jobs. |
| `PREVIEW_EVENT_INVALID` | Malformed/schema-invalid event; reconcile with engine snapshot. |

`PREVIEW_MEDIA_FAILED`, `PREVIEW_PLAYBACK_FAILED`, `PREVIEW_STATUS_FAILED` and
`PREVIEW_JOB_FAILED` remain unknown envelopes when no precise root cause is known.
In particular, raw FFmpeg error text is not classified through substring guessing.
Generic background failures show a failed-preparation template, keep raw details
and diagnostic references collapsed, and create pending tasks through the
Assets card even when the asset is not on the timeline. The active Preview can
show the same failure without recording a duplicate task. Re-rendering a notice
does not repeatedly record it; explicit new failures may add occurrences.
Recording failure is visible and never starts playback, preparation or an edit.

Notices/status now sit below the preview canvas in the scrollable pane so verbose
guidance cannot cover playback images or overlap the retry controls. Playback
retry remains explicit, originals still play while optional optimization runs,
and completed proxies still switch in only after pausing.

The existing inbox filename/endpoints remain unchanged for compatibility. Relaunch
the engine to accept the new validated preview operations/stages/outcome. No
unresolved records are removed or marked verified by adding this coverage.

#### Edit/save and import

- Import recovery uses **Check import result**, **Load Assets for review**, and
  **I reviewed Assets - continue importing**. Loading never resubmits; continuing
  only releases the import gate after explicit asset-list review. Stale results,
  mismatched projects/folders and failed reads never release it. Review loads
  are serialized so a concurrent status response cannot bypass review.
- File chooser, per-file, submission, receipt-check and review-load notices
  share the catalog and durable inbox. Historical `unknown-edits` API and
  `unknown-edit-errors.json` names remain for compatibility; they now accept
  validated import contexts too. Existing tasks are not renamed or deleted.
- Import submission retains its small pre-execution rejection allowlist;
  other failures require an authoritative receipt before being called not applied.
  Edit/save outcome metadata is unchanged. Normal pending imports use neutral
  progress rather than an error notice.
- Edit/save UI uses catalog explanations; Error details contains the raw in-memory
  engine message and optional diagnostic reference. That text is **not** persisted
  to the unknown inbox or its copyable task reports.
- Buttons: **Check whether edit saved**, **Load saved project for review**, and
  **I reviewed my last edit - continue editing**. Review explains that Undo/Redo
  history is cleared. Existing guards and explicit review are retained.
- Command failures may include `outcome: "not-applied"` only when the engine knows
  the request was rejected or failed without application. The client can finish
  rejection handling without querying an absent receipt. Old-engine responses,
  duplicate-attempt replies, timeouts and unexpected errors still require receipt
  recovery. Codes alone never establish an outcome.
- Engine data directory contains `unknown-edit-errors.json`, at most 100 unique
  groups and 256 KiB when loading. Each entry is a pending local task, grouped by
  code + stage + outcome + operation, with first/last timestamps, count, engine app
  version and most recent optional diagnostic UUID. No time-based eviction:
  unresolved tasks stay until explicitly resolved. A full inbox refuses new groups
  and surfaces recording failure; repeats can still increment their existing group.
- Authenticated local endpoints: `GET`/`POST /diagnostics/unknown-edits`. Payloads
  accept only validated code/context and optional diagnostic UUID. Arbitrary strings
  in malformed code fields become `UNRECOGNIZED_CODE` on the client; private fields
  are rejected by the server, not stored. Do not put user data in error codes.
- **Development: unknown-error follow-ups** is a collapsed editor section. Load
  local follow-ups to view pending tasks and select/copy sanitized JSON reports.
  This creates no remote issues or uploads.
- Resolution workflow: investigate a pending report, add its precise catalog match,
  add a regression test and verify behavior, then add its exact fingerprint to
  `VERIFIED_ERROR_RESOLUTIONS` in the executable catalog. The next inbox read/record
  removes only entries matching both a verified fingerprint and a current definition.
  Generic fallback coverage or merely adding a definition does not erase tasks.
- Storage/API failures are visible and never change edit safety. No recording retries
  resend the original timeline edit. Existing bounded diagnostic JSONL logs are unchanged.
  The inbox uses its own atomic snapshot in the same engine data directory because
  append-only diagnostic logs cannot remove individual catalogued follow-ups.

Focused local validation: 54 tests passed across catalog matching/privacy, durable
inbox grouping/capacity/resolution, API outcome metadata, actual editor save/recovery
flows and relevant persistence regressions. Affected typechecks, lint and client
production build passed. No full-suite or broad manual/codec certification is implied.

Import adoption validation: 74 focused tests passed across catalog matching,
Assets/Help, durable inbox, import API/cleanup and affected editor regressions.
Affected lint, schema/engine/client typechecks and client production build passed.
This does not replace desktop acceptance after relaunch.

Preview adoption validation: 110 focused tests passed across playback/source
continuity, specific recovery notices, import regressions, status reconciliation,
Help, editor job gating, catalog matching and durable inbox behavior.
Affected lint, client/schema/engine typechecks and client build passed. An isolated
browser fixture at a 340x220 pane verified guidance below the canvas, collapsed
details and a scroll-reachable refresh control; the fixture was removed afterward.
This is not a full-suite result or desktop codec certification. The shared browser's
standalone engine connection was unavailable, so live development-inbox review
remains a desktop follow-up after relaunch; no existing tasks were cleared.

Owner subsequently reported the preview walkthrough passes after relaunch
(2026-11-03). This is manual feedback, not broad codec certification or confirmation
that every pending development task was inspected.

Export adoption validation: 132 focused tests passed across export dialog recovery,
attempt correlation, cancellation, engine duration/cleanup behavior, catalog matching,
durable inbox, Help and affected preview/import/status regressions. Affected lint,
client/schema/engine typechecks and client build passed. An isolated browser fixture
at 458x560 verified cleanup guidance, collapsed details, modal fit and reachable
Close with one mocked export request and no unknown-task write. The fixture, fetch
mock and viewport change were restored afterward; no real project/export was used.
The first request-interception fixture could not intercept its synthetic endpoint;
the successful check used an in-page mock limited to that synthetic endpoint.
No full-suite result is implied. Export desktop acceptance and a successful live
inbox review remain pending; no unresolved records were cleared.

Live inbox review (2026-11-05): the desktop engine data directory
(`%USERPROFILE%\.video-editor-prototype`) contains no `unknown-edit-errors.json`, so
no unknown error has been recorded across owner testing; nothing was cleared.

### Remaining work

Review pending unknown-error tasks and investigate root causes in bounded follow-ups.
Root causes behind repeated recovery states still need investigation from
real diagnostic evidence; clearer text is not proof those causes are fixed.
Restart the desktop app after engine changes before manual acceptance.

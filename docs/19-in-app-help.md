# In-App Help

[Back to index](./README.md)

Help is available from Projects (even when the engine is unavailable) and the
editor toolbar. It opens a dismissible offline window without submitting edits,
changing selection, or intentionally pausing/resuming playback.

## Sections

- **About**: client package version, connected engine version when available,
  development-prototype status, local processing and no automatic error-report
  upload. No source revision/build ID is fabricated when none is supplied.
- **How to use**: project/import, timeline navigation/editing, Properties/speed,
  autosave/recovery, relinking and export.
- **Current features**: available features, limitations/experimental behavior,
  and planned features explicitly labelled as unavailable.
- **Animation catalog**: live shared entrance/exit presets, descriptions, stable
  IDs/versions, defaults, duration/split rules and explicit future-editor limits.
- **Errors & troubleshooting**: searchable live edit/save, import, preview and export catalog, including
  outcome/stage/operation applicability and safe next actions. Unknown-error
  fallback explains uncertainty, file-only failures, preview availability and
  failed renders. Generic unexpected failures remain uncatalogued investigation
  tasks. Development task reports stay in their separate editor disclosure.

Preview task guidance explains explicit retry/Play, Relink, optional original-video
optimization and status refresh before repeating uncertain preparation/cancellation.
Preview availability is not labelled as a rejected timeline edit or proof of export readiness.

Export guidance distinguishes initial rejection, unconfirmed start/progress/cancel,
and failed rendering or cleanup. Progress can be stale; status must identify the
same attempt. Wait for cancellation cleanup rather than treating acknowledgement
as success, and never assume leftover files are verified exports.
The export guide also covers MP4/H.264 frame-rate, aspect-preserving resolution
and quality presets, their unchanged project timebase, fps/upscaling limitations,
frozen active-attempt settings and dialog-local defaults. Validation rejection
and rendered-settings mismatch have separate searchable catalog definitions.

The canonical structured guide/feature content is
[helpContent.ts](../apps/client/src/helpContent.ts). Reuse/update these entries
when capabilities change rather than maintaining a second complete help guide.
Detailed engineering/manual documentation remains linked through this index.
The error tab reads the same
[executable catalog](../packages/schema/src/errorCatalog.ts) used by recovery UI;
the [error definitions document](./18-error-catalog-and-recovery.md) explains
matching, safety and the unknown-error lifecycle.

## Interaction and acceptance

- Help uses the existing native modal, focus containment, Escape dismissal and
  opener-focus restoration. Arrow keys, Home and End navigate the five tabs.
- Only the selected tab panel is rendered. Long content scrolls within the window;
  search works locally by code, title, explanation, next action or operation.
- Editor shortcuts are suppressed while Help is open. Existing playback is not
  stopped or restarted; project mutations are blocked by the native modal.
- No engine requests are made by Help. About uses already available health data;
  client version is read from the package manifest.
- Manual acceptance: open Help from Projects with the engine unavailable; switch
  tabs with pointer/keyboard; search a known and unknown code; inspect feature
  status labels; close with Escape and verify focus returns. In an active project,
  open Help during playback and verify it continues; Space/Delete/Undo inside
  Help must not affect playback/timeline. Check the window at narrow app widths.

Focused automated checks cover offline content, version/feature honesty, live catalog
search, keyboard tabs, dismissal/focus restoration, both Help launchers and editor
shortcut/playback isolation. A real browser check verified catalog search with no
engine connection, Escape/focus restoration and window fit at a 458x560 viewport.
This does not certify every desktop size or codec. Help content is client-only;
animation rendering and saved-schema changes require an app relaunch.

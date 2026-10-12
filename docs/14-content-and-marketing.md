# 14. Public Participation and Demo Guidance

[Back to index](./README.md)

## Purpose and participation

A Windows-first desktop video editor prototype with save/open, proxy preview, split/delete and MP4 export. Local AI guidance and reviewed jump-cut candidates are planned, not shipped.

This independently maintained community project prioritizes reliable workflows, reproducible tests and understandable engineering. See the [bounded scope](./01-overview-and-scope.md#maintainer-purpose-and-scope-gate), [contribution terms](../CONTRIBUTING.md) and [license scope](../README.md#license-and-participation). Technical plans are not guaranteed delivery dates.

Bug reports, isolated reproductions, documentation improvements and reviewed code contributions are welcome. Sponsorship supports maintenance, testing and development; it does not automatically purchase ownership, exclusivity, priority or feature delivery. Material commitments require separate agreement and explicit scope approval.

## Current capability and demo limits

| Capability | Current evidence / demo boundary |
|---|---|
| Create, save, reopen | Implemented, including backup recovery and nonfatal recent-list warnings |
| Import and proxies | Video/audio reference or copy import; video proxies with progress. Copy-byte progress and disk-space UI are not implemented |
| Timeline and preview | One-track add/split/delete, scrub/zoom and playback; cut/end correctness and media-error recovery still have known limits |
| MP4 export | Implemented; lifecycle/cancellation/output regressions pass locally. Polling/cancel recovery and client offline-asset policy remain open; output publication needs filesystem hard-link support |
| Modal input policy | Component and prior native-browser smoke evidence; not complete screen-reader/native-picker acceptance |
| Multi-track controls, undo/redo, relink | Planned M3; not demo-ready |
| AI guidance/proposals/jump-cut candidates | Planned M4-M6; not demo-ready |

Use the [review record](./16-review-plan-and-system-status.md) and [backlog](./10-future-features.md) for current verification and limitations. Do not use an older green CI run as proof of newly changed, unpushed code.

## Accurate design statements

- **Local-first:** current media processing uses external FFmpeg and the default local engine. AI analysis is planned; model/setup downloads, configurable endpoints and shared support data prevent an absolute no-network/privacy guarantee.
- **Reviewed AI edits (planned):** proposals and candidates require confirmation; AI-labelled undo history is not implemented.
- **Non-destructive workflow:** editing refers to source ranges and derived outputs rather than intentionally rewriting originals. This is not a guarantee against all filesystem or user-configuration failures.
- **Separate preview/export:** preview uses lower-resolution proxies; export uses originals. Approximate preview is not frame-exact certification.
- **Open architecture:** shared timeline logic leaves future delivery options open; it does not certify mobile or additional desktop platforms.

Future example, not a current capability: describing "attaching a keycap between 0:30 and 2:00" would produce reviewable jump-cut candidates after M6 implementation and evaluation.

## Public documentation boundaries

Keep setup, usage, architecture, schema/API contracts, technical decisions, tests, known limitations, roadmap, licenses and contribution rules public. Sensitive personal/business planning belongs outside this repository; public review records should retain technical constraints without reproducing private planning.

Archived prompts/specs are historical source material, not current requirements or shipped features. They may remain public when clearly labelled and rights-cleared. Neither private planning nor the archive overrides the maintained technical scope.

Do not commit credentials, private agreements, raw support logs, personal data or user footage. Use synthetic fixtures for reports. A Git ignore rule or current-file removal does not erase previously published history or copies.

## Demo and publication checklist

- [ ] Label the software a prototype and distinguish planned features.
- [ ] Publish approved license/contribution terms before inviting reuse or external code.
- [ ] Check the applicable [R1-R5 gates](./10-future-features.md#legal-and-publication-readiness-backlog); downloadable alpha/beta builds require compliance before publication.
- [ ] Use owned or appropriately licensed footage/music, with any necessary permissions for identifiable people. "Royalty-free" alone does not establish redistribution rights.
- [ ] Redact tokens, usernames, paths and private project information from screenshots, recordings and reports.
- [ ] State hardware, method and scope for performance comparisons; do not invent benchmarks.
- [ ] Describe only capabilities actually demonstrated, including unresolved recovery and playback limits.
- [ ] Preserve applicable dependency/binary/model notices and obligations; Apache-2.0 does not replace third-party terms.

Promotion, sponsorship or commercial interest does not automatically expand the approved roadmap.

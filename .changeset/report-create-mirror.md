---
"@reddoorla/maintenance": patch
---

The drafting path now dual-writes its report state into Turso (#539 Phase 5).

Before this, the only report mirrors were UPDATEs on the request path (approve,
override, delivery status, commentary). Everything the DRAFTING path writes
reached Turso only via the hourly sync — and two of those gaps are visible to the
operator today: a fresh draft's row does not exist, and its preview route answers
"No rendered body stored for this report." for up to an hour.

`makeReportMirror` covers all four writes as one injected object:

- **created** — `mirrorReportInsert`, the first INSERT-capable report mirror. It
  maps with the importer's own `mapReportRecord`, which is also what parity diffs
  against, so the row is parity-clean by construction rather than by a column
  list someone has to remember to extend.
- **body** — the rendered HTML, stored where the console preview reads it.
- **patch** — the queue flag, for the new draft AND every row it supersedes;
  mirroring only the new one would show a site with two queued reports.
- **patch** — a re-run's refreshed scores on the announce/launch reuse paths.

Wired at the composition roots (the nightly `--due` batch, `announce`, `launch`)
rather than defaulted inside the recipes: a default would open a real libSQL
handle from inside `draftReportForSite`, which every unit test calls, and on a
machine with `TURSO_*` exported that means tests writing into production.

Unlike the Phase 3 mirrors this one never returns null. #585 is why: that helper
returned null without creds and the dual-write silently no-opped for weeks,
because a dead mirror and a healthy one produced identical output. Here
creds-absent is a state the mirror reports, so every write emits one
`REPORT_MIRROR` line and an absent line means the wiring is gone.

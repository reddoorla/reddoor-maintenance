---
"@reddoorla/maintenance": minor
---

Only one report is queued for approval per site at a time, highest tier wins. Report tiers form
a superset chain — Maintenance ⊂ Testing ⊂ {Announcement, Launch} — so a higher-tier draft makes
lower ones redundant. A new shared `queueDraft` (src/reports/queue.ts), called by every draft
path (`draftReportForSite`, `announce`, `launch`):

- Supersedes lower-tier reports already pending approval for the site by **un-queuing** them
  (clears `Draft ready` — the row is kept, not deleted), then queues the new one.
- Stands down (leaves the new draft un-queued) when an **equal-or-higher** tier is already
  pending — e.g. a queued Testing blocks a new Maintenance draft, and a queued Launch blocks a
  new Announcement (the existing one is kept rather than silently replaced).

The `report` CLI surfaces the outcome ("drafted but NOT queued…" / "superseded N lower-tier
drafts"); `draftReportForSite` returns `queued` + `supersededIds`, and `announce` results carry
`queued`.

The nightly `--due` run now distinguishes a draft `queueDraft` intentionally un-queued from one
wedged half-made by a crash: if a higher-or-equal-tier report is still pending for the site, the
not-ready row is skipped instead of re-completed — otherwise it would re-render and append a
duplicate HTML attachment every run only to be re-blocked.

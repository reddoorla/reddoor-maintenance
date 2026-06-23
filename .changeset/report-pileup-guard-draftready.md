---
"@reddoorla/maintenance": patch
---

fix(report): a superseded draft no longer permanently blocks future Maintenance reports

The pile-up guard skipped a new-period draft whenever an earlier-period draft for the same (site, type) was still unsent — but a draft that a higher tier _superseded_ (`draftReady=false`, never sent) also matched that condition, wedging every future Maintenance draft for the site forever (Reddoor's live failure: Maintenance + Testing both monthly). The guard now additionally requires `draftReady`, so only a genuinely pending-approval draft blocks.

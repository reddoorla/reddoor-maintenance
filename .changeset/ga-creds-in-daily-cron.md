---
"@reddoorla/maintenance": patch
---

daily-reports cron can finally reach GA + Search Console, and an unwired
environment now says so instead of going quiet.

GA/Search enrichment runs at DRAFT time, but `daily-reports.yml`'s drafting step
only ever passed `AIRTABLE_PAT` + `AIRTABLE_BASE_ID` — no GA credentials existed
anywhere in `.github/workflows/`. So `readGaConfig()` returned `null` on every
scheduled run and both `fetchGaUsers`/`fetchSearch` took their not-configured
early return. Every CI-drafted report shipped with blank GA numbers (which drops
the whole ANALYTICS section from the client email, since `analyticsSection()`
renders `""` with no data), no search position (so the maintenance template fell
back to the bare "Google Indexed" label instead of "Page 1 Google Result (#N)"),
and **no `Maint: Google Indexed` evidence record at all** — which the dashboard
rendered as a bare amber "needs you" pill with an empty note and nothing to drill
into. Caught on Sonder's 2026-07 maintenance report; Search Console in fact had
the site at position #2.

The step now takes `GA_SUBJECT` + `GA_SA_KEY_JSON` (the key file's contents,
written to `$RUNNER_TEMP` because the code takes a path) — both need adding as
repo secrets; `docs/SETUP.md` has the `gh secret set` lines.

`fetchSearch` also splits the old single skip in two. An un-enrolled site stays a
true skip (nothing to measure, box stays manual), but an **enrolled** site with no
credentials is now `notConfigured` and produces an honest `unknown` evidence
record noting "Search Console not configured in the environment that drafted this
report". Gating is unchanged — Google Indexed is still advisory on Maintenance and
still gating on Testing (where an absent record already coerced to `unknown`), so
no report's approvability moves.

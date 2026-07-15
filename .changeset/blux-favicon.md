---
"@reddoorla/maintenance": minor
---

blux: capture the export favicon. Every Blux export declares its favicon as a
bare media uuid in `settings.favicon` whose CDN url appears only in the
rendered `<link rel="icon">` tags (the uuid is routinely absent from the media
dict). assembleIR now resolves it from the scraped urls onto
`SiteIR.meta.favicon` — kept off the plan-bound assets list so it never rides
the migration into Prismic media — and `blux convert` downloads it beside the
plan as `favicon.png` (via the same injectable fetch seam as `--probe`). A
fetch failure never fails the command: the `{assetId, url}` pair is preserved
as `favicon.json` so the download can be re-run by hand.

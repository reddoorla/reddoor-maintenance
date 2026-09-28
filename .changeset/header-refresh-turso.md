---
"@reddoorla/maintenance": patch
---

The draft-time header refresh reaches the client again

`refreshHeaderImage` runs on every real draft and on `announce`. It captured a
fresh homepage screenshot and uploaded it only to Airtable's `Header image`
attachment. Since #864 (2026-09-17) the send reads the site's header plate from
Turso, and every site has one, so the refreshed screenshot never reached a
client email. Since #933 turned the Airtable shadow off, it went nowhere at all,
while the function still reported success.

It now writes the plate into Turso `sites.header_image`, through the same
`storeHeaderImage` path as `header-image --write-back`, using the same
`generateHeaderImage` clean plate. It is still best-effort: a failed capture or
store warns and returns false without failing the draft, and that includes
running with no Turso configured. `RefreshHeaderDeps.upload` is replaced by
`store`.

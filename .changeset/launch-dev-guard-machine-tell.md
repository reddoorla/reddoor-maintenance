---
"@reddoorla/maintenance": patch
---

launch: the dev-guard denies on a machine tell the installed twin emits, not on its human-readable message (#719)

The `launch` dev-guard refused an unguarded `/dev/match` twin by matching the
prose of its 404 — `/no (matching )?assembly for/i`. The clause is load-bearing:
an unguarded twin asked for a uid it lacks 404s through the site's own
`+error.svelte`, byte-for-byte the guard's PASS condition, so on any site whose
fixtures lack `home` the message was the only thing separating "the guard
fired" from "no such uid". Reword that message in the harness template — "no
document for", "unknown uid" — and the guard silently stopped denying. It
failed OPEN: the launch proceeded with the site's fixtures public, and nothing
logged it.

The contract is now a machine tell, `UNGUARDED_TWIN_TELL`
(`reddoor-match-twin:no-assembly`), exported from the match-harness template
and placed ahead of the human text in the installed route's 404. `launch.ts`
builds its marker from that imported constant, so the route and the guard
cannot drift apart without a type error. The two prose wordings are still
accepted, on purpose and for now: beachfront-dentistry's on-disk twin predates
the tell and any site installed before it says "no assembly for"; drop the
alternates once beachfront's twin is re-installed from the harness — until then
they only widen the deny.

The test takes the installed template string itself: it trips the marker, and
still trips it with every "assembly for" wording replaced — the tell alone
carries the deny. Red before: the template carried no tell, and a reworded
template matched nothing.

The route body this changes was corrected once already in 0.95.1's successor
(#763) and never tagged since, so the 0.95.1 snapshot under
`scripts/match-harness-previous/` remains the pre-change body every installed
site holds; no new snapshot is needed for the upgrade path.

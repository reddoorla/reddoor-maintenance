---
"@reddoorla/maintenance": patch
---

a11y audit: a fixture route the site does not define is not a missing route (#900)

The route-status guard (#807, closing #680) assumed every site defines both
built-in fixtures. Eight do not. Seven ship no `animateIn` action at all, so
`/dev/animate-in` exercises code that is not there; they read as green only
while their pinned package predated the guard, and the first Renovate bump past
it turned all eight red on a route that was never theirs.

A built-in fixture whose directory is absent from the site's own `src/routes`
tree now skips on a 404 instead of failing, and the summary names it and says
why: `1 of 2 routes (1 skipped: animate-in demo — fixture not in this site's
source)`. Two things keep that narrow. A fixture that IS in the tree and 404s
is still a violation, which is the case #680 exists for. And when `src/routes`
cannot be read at all, nothing is marked absent, so "I could not tell" can
never read as "the route is absent".

Only the two built-in fixtures are eligible. A route opted in through
`package.json#reddoor.a11yRoutes` is a real page, usually Prismic-backed with
no directory of its own, so a source check there would mass-skip the routes
opt-in exists to keep honest.

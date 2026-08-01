---
"@reddoorla/maintenance": minor
---

Let a site opt the `a11y` audit into scanning its real routes.

The audit only ever axe-scanned two synthetic fixture pages
(`/dev/a11y-fixtures`, `/dev/animate-in`). No real page was ever checked, which is
how five production pages on gallerysonder shipped a hero `<img>` with no `alt`
attribute — a critical violation — with CI green the whole time.

A site now lists its own routes in `package.json#reddoor.a11yRoutes`, and they are
scanned **in addition to** the fixtures (which stay: they cover design-system
components in isolation, which no real page does). Each violation is reported
against the route path so it is attributable. Junk entries are dropped and an
absent or unusable key leaves behaviour byte-identical to before.

Opt-in rather than automatic on purpose: the shared CI workflow runs this audit
with `--fail-on-violations`, and most of the fleet carries pre-existing
accessibility debt, so enabling it centrally would red every repo at once.

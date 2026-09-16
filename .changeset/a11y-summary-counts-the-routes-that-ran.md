---
"@reddoorla/maintenance": patch
---

a11y: the summary counts the routes that ran, not the fixture defaults (#697)

`a11y.ts` built its pass summary from `a11yRoutes.length` — the two dev fixtures
imported from `configs/playwright-a11y.js` — while the list it actually scanned
was `axePages`, built 60 lines earlier by merging those fixtures with the site's
`package.json#reddoor.a11yRoutes`. So every site that opted in was told its
routes had not run, in output byte-identical to before the key existed, on the
one command an operator uses to confirm the opt-in worked.

Hit live on `vida-legacy-foundation`: eight real routes added, audit reported
`0 violations across 2 routes (+1 hydration smoke)`. All ten pages had been
scanned the whole time. Settling that needed racing the `finally` that deletes
the generated spec — the count is the only thing the operator can see, and it
was the one thing lying.

The failure mode this invites is the expensive one, and it is worth naming
because the fix is one line and the damage would not be: conclude the key is
broken, revert it, and lose exactly the coverage it exists to provide. Scanning
only fixtures is how a critical `image-alt` violation shipped to five production
pages on `gallerysonder` with CI green throughout.

Two things went in alongside the count, both from the issue:

- **The split is named when there is one** — `across 10 routes (2 fixtures + 8
from package.json)`. "10 routes" alone still leaves an operator counting on
  their fingers to check their eight arrived, and the confirmation is the whole
  point of the line. A site with no opt-in keeps its old summary byte-for-byte,
  which is nearly the whole fleet.
- **The fail path carries the count too.** It was a bare
  `a11y: N violations`, so a failing run could not tell you how much it had
  covered either.

The merge was always correct and always tested; what nothing asserted was the
sentence. Telling "2" from "2 + 0" needs a fixture whose config contributes
routes, which is why no existing test could have caught it — so the new ones do
exactly that, and were checked against the unfixed source: three fail without
it, and the two guarding the unchanged cases pass either way.

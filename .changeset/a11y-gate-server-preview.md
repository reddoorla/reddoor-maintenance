---
"@reddoorla/maintenance": patch
---

a11y + playwright-a11y: a site can opt its browser gates onto a production build with `package.json#reddoor.gateServer` (#700)

Both browser gates started the system under test with `npm run vite:dev`, so the
production bundle was built in CI and then never opened by a browser. That is
not a theoretical gap: dev does not merely fail to reproduce some defects, it
hides them. Module graph, code splitting, minification and asset hashing are
most of what "hydration works" actually means, and vida-legacy-foundation spent
a day on a `<noscript><style>` runway defect of exactly this class.

The switch is opt-in per site — `"gateServer": "preview"`, absent meaning `dev`
— because a preview costs a build per run, and because of the trap underneath
the naive version of this change. The axe scan targets `/dev/a11y-fixtures` and
`/dev/animate-in`, dev fixture routes with no guarantee of surviving a
production build; a straight swap would have had #680's route-status guard
correctly report every fixture as a missing route, turning a working gate into a
red one that measures nothing.

So the audit's run is split rather than moved, which is also the option recorded
from #727:

- `src/audits/a11y.ts` — under `preview` the synthesized config declares TWO
  webServers. axe keeps `vite dev` on its own port (fast, and the fixtures
  certainly exist there); the hydration smoke — the part dev actually hides —
  gets `npm run build && npm run preview` on a second port, and the spec
  navigates those routes by absolute origin so they cannot silently fall back to
  dev. Both servers keep `--strictPort`, the site `cwd` and
  `reuseExistingServer: false`. The playwright spawn budget goes to 10 minutes
  so a build is not SIGKILLed mid-flight and reported as an audit failure.
- `src/configs/playwright-a11y.ts` — the shared config each site's smoke suite
  re-exports gains the same opt-in, plus `REDDOOR_GATE_SERVER` for a one-off CI
  run. Its readiness probe moves to `/` under preview: keeping it on
  `/dev/a11y-fixtures` would hang for the whole webServer timeout and read as
  the site's failure. The server budget goes to 5 minutes for the same reason.
- The summary says which server ran (`+1 hydration smoke on a production
preview`). #697's lesson is that an opt-in which does not visibly take effect
  gets reverted as broken.

An unrecognized value (`"prod"`) reads as `dev` everywhere rather than reaching
a shell as `npm run prod`. A site that has not opted in is byte-identical to
before, which is asserted rather than assumed.

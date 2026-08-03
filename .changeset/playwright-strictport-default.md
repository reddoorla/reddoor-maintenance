---
"@reddoorla/maintenance": patch
---

Pin the a11y/smoke webServer to the port its readiness probe polls, always.

`configs/playwright-a11y` applied `--port ... --strictPort` only when
`REDDOOR_SMOKE_PORT` allocated one, on the reasoning that we should "fail loudly
rather than let vite drift to a free port the baseURL doesn't point at". That
argument covers the unset case too, and the unset case did not get it: 5173 is
equally a fixed port that `baseURL` and the probe URL are pinned to, while vite
was left free to drift off it.

So when anything else holds 5173, vite starts on 5174, the probe keeps polling
5173, and the suite dies on `Timed out waiting 120000ms from config.webServer` —
two minutes of silence naming neither the port nor the squatter. Observed on
the-pointe-burbank, where it read as an environment problem and got written off;
it was hiding a genuinely failing gate test for two rounds of work. With
`--strictPort` the same situation fails in a second with `Port 5173 is already
in use`.

No overlap with `reuseExistingServer`: that check runs before the command, so a
dev server already serving the probe URL is still reused and vite is never
started. `--strictPort` bites only when the port is held by something that is
not the server under test — the case worth failing on.

`configs/lighthouse` had the same gap and it fails worse — silently rather than
loudly. Its `url` is pinned to 5173 while `startServerReadyPattern` matches
vite's "ready in" line whatever port it settled on, so a squatter on 5173 means
vite comes up on 5174, announces itself, and lighthouse collects from 5173:
auditing the squatter and reporting its scores as the site's. Same two flags
applied. (Both audits already did this for themselves — `src/audits/a11y.ts` and
`src/audits/lighthouse.ts` allocate a free port and pass `--strictPort`; it was
only the shared configs sites consume directly that were left behind.)

Sites inherit both on their next package bump; no per-site change needed.

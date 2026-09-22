---
"@reddoorla/maintenance": minor
---

a11y audit: a fixture the site does not define is a `warn`, not a missing route (#900)

The route-status guard (#807, closing #680) assumed every site defines both
built-in fixtures. Eight do not. Seven ship no `animateIn` action at all, so
`/dev/animate-in` exercises code that is not there; the eighth,
`reddoor-website`, ships the action without the fixture and is getting the
fixture instead (reddoorla/reddoor-website#210). All eight were measured red on
2026-09-22; #900 recorded six when it was filed, and the other two followed on
their next bump.

A built-in fixture whose directory is absent from the site's own `src/routes`
tree no longer fails the audit on a 404. It is **skipped and the audit goes to
`warn`**, because absence is inferred from the tree and a tree cannot tell "never
had it" from "deleted last Tuesday" — and the second is a loud red today on the
seventeen sites that do ship the fixture. `warn` does not change the exit code,
so CI is unblocked, and the audit's own verdict stops saying a half-scanned
site is clean. Be precise about how far that visibility reaches: nothing
persists an a11y _status_, only the violation count, so the warn shows in the
run's table and nowhere durable. Closing that is
reddoorla/reddoor-maintenance#910, not this change. A site
that declares the absence in `package.json#reddoor.absentFixtures` gets a clean
`pass` back. A declared fixture that IS in the tree is scanned exactly as
before, so a stale entry can never silence a real route.

Three safety properties, each proven by mutation rather than assertion:

- Only `ENOENT` and `ENOTDIR` mean absent. `EACCES`, `EMFILE`, `ELOOP` and
  `EIO` all mean "I could not tell", and under the fd pressure of a concurrent
  sweep an earlier cut would have turned a real 404 into a skip.
- Entry names are matched exactly by reading each directory, not by `stat`ing a
  joined path. macOS folds case and Linux does not, so a wrong-case tree read as
  present locally and absent on the runner that gates the merge.
- `/dev/a11y-fixtures` can never be skipped. It is the dev server's readiness
  probe, and Playwright treats any status at or above 404 as not ready, so a
  site missing it never reaches the spec at all. It now fails fast naming the
  route and the reason instead of timing out after 120 seconds naming neither.

SvelteKit route groups are traversed, so a fixture under `(marketing)/dev/` is
seen. Nothing in the fleet uses one today; it is handled because the failure it
would otherwise cause is silent.

`package.json#reddoor.absentFixtures` entries are normalised before they are
compared, so `dev/animate-in` and `/dev/animate-in/` declare what they meant
rather than silently declaring nothing, and the readiness failure names the key
so an operator has a stated remedy.

`describeSkipped` now pairs each route with its own reason once more than one
reason is in play, and a reason carried only by a skip past the display cap is
still named after the `+N more`. A placeholder-repo skip clears itself at `/new-site` step 6
and an absent fixture is permanent, and the previous flat list invited a reader
to attach the first reason to every route.

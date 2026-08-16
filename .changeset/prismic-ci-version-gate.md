---
"@reddoorla/maintenance": minor
---

`prismic-ci` now refuses a site whose installed CLI cannot run the workflow it
would install.

The reusable workflow does not install this package. It runs `pnpm install
--frozen-lockfile` and then the site's **own** `reddoor-maint` bin, so the
version that executes in a client repo is whatever that repo's lockfile pins.
`prismic-models` first ships in **0.83.0** — verified by installing it from the
registry and running `reddoor-maint prismic-models --help`, not by reading a
changelog. Installing the caller next to an older binary yields a workflow that
fails on its first model PR, in a client repo, with an error naming an unknown
command rather than a rollout that ran too early.

Measured across the twelve delivery candidates at the moment 0.83.0 published,
every one of them pinned something older — 0.28.0, 0.65.0, 0.67.0, 0.69.0,
0.75.1, 0.80.0, 0.81.0, 0.82.0. A rollout that day would have broken all twelve.

The gate reads the **lockfile**, never the `package.json` range: espada declares
`^0.81.0` while its lockfile resolves 0.69.0, and CI installs frozen, so the
range is not what executes. It parses only the `importers:` section — the
`packages:`/`snapshots:` sections list every transitively resolvable version and
would happily report one nobody installed.

Three refusals, deliberately distinct, because a gate that cannot tell "too old"
from "could not read" reports one as the other:

- **too old** — names both versions and says to bump the dependency and commit
  the lockfile
- **cannot establish** — no lockfile, an unreadable one, an unrecognised shape,
  or the package absent
- **ambiguous** — two importers resolving different versions, named, rather than
  a coin flip deciding whether a client repo gets a workflow it cannot run

"Could not establish" REFUSES rather than proceeding. The asymmetry is
deliberate: the cost of waiting is a re-run, and the cost of being wrong is
broken CI on someone else's repository.

The version comparison is numeric, position by position. As strings `"0.9.0" >
"0.83.0"`, so a lexicographic gate would wave through a site pinned seventy-four
releases before the command existed — that specific inversion is covered by a
test, and confirmed to fail against a string-comparison implementation.

---
"@reddoorla/maintenance": patch
---

match-harness: a fail-closed release guard — a shipped body cannot change without a snapshot of the one it replaces (#753)

`MATCH_HARNESS_PREVIOUS` is what lets an ALREADY-INSTALLED site take a fix: the
recipe byte-compares the site's copy against the renders it previously shipped,
and `replace`s a match. A body with no recorded predecessor gets `flag` instead
— the site is accused of a hand edit it never made, and because the recipe never
overwrites a flagged file, that file is left broken permanently.

Nothing enforced the pairing. The generator's own comment called snapshotting
"a manual step at release time", which is another way of saying the guard was a
person remembering.

`scripts/check-match-harness-snapshots.mjs` now compares every shipped body
against the previous release tag and fails when a **recipe-owned** body changed
and no committed snapshot carries what that tag shipped. It runs in `pnpm
verify`, so `ci.yml` gains the step and `fetch-depth: 0` — a shallow checkout
has no tags, and the guard refuses to pass over a comparison it could not make
rather than reporting a clean bill of health.

Proven in both directions before being trusted. Green on the tree as it stands:
17 bodies compared against `v0.95.1`, no offenders. Red on a deliberately
unsnapshotted change — mutating `matching/gate.sh` (byte-identical at `v0.95.1`
and HEAD, with no `0.95.1` snapshot) reports exactly `matching/gate.sh`, with
the mutation asserted applied first so it cannot pass for the wrong reason. A
**site**-owned body changing is correctly not an offence: `planFileWrite` skips
a site record before `previous` is ever consulted.

Two findings from building it, both recorded because they nearly became wrong
claims. Snapshots are matched by CONTENT across any version directory, not by
`<version>/<rel>` path: `census.sh`, `strikes.mjs` and `build-spec.mjs` are
byte-identical at v0.95.0 and v0.95.1, so a per-version rule would have
false-alarmed on three files. And two successive hand-rolled parsers of the
generated `template.ts` produced confident false "the snapshots are corrupt"
verdicts — one terminating a body on an escaped ``\`;`` inside
`build-spec.mjs`, the next dropping each body's trailing newline (every
"mismatch" was off by exactly one byte). Every committed snapshot in fact
matches its tag byte-for-byte.

---
"@reddoorla/maintenance": patch
---

`match-harness`: a green out of `gate.sh` and `next.mjs` now has to be produced by runs that happened.

The shipped `matching/gate.sh` printed `echo "$page exit=$?"` — the status, then thrown away — and reported `ALL DONE ($TAG)` unconditionally. Measured on 29 Navy against the real `page-diff`, with the reference alive and no dev server running:

```
REF OK — https://www.29navy.com/ → 200, no redirect, refMark present, candMark absent
########## home ##########
home exit=1
ALL DONE (repro1)
```

Exit 0, and `matching/out-repro1-home/` was never created. Two cheaper variants of the same green: `gate.sh nosuch nosuchpage` printed `ALL DONE` having run nothing and printed no page header, and a crashed re-run under a tag used before leaves the previous round's report byte-identical (`lib/report.mjs` mkdir -p's the output directory and never clears it) — so "require report.json" on its own reproduces the green one step along.

`matching/next.mjs` summed its denominator over the pages that happened to report, so a page whose `page-diff` crashed was subtracted from both sides: eight of nine pages could read `SCORE 160/160` while the ninth was never measured, and an empty backlog then printed "Backlog is empty" and exited 0.

The exit status cannot be the fix. `page-diff` exits 1 for a region that legitimately FAILED and node exits 1 for an uncaught throw before it looked, so the status cannot tell a finding from a crash — and a matching round's steady state is a failing gate. The evidence is instead the artefact only a completed run leaves:

- **`harness.mjs`** gains `uncountable(meta)` — `next.mjs`'s own countability filter, moved here so the gate and the scorer cannot drift about what counts — and `checkRun(page, dir, startedAt)`: the report exists, it is countable, its `meta.generatedAt` is not older than this run, it ran the matrix and the anchors the table declares, and every viewport it claims is represented in its regions. A new `--check-run` CLI mode exposes it, with `startedAt` required rather than defaulted.
- **`gate.sh`** counts what it attempted and what it measured, prints `NOT MEASURED: <reason>` per page, ends with `GATE INCOMPLETE (tag) — N of M page(s) produced no countable report`, refuses a page argument that matches no row, and otherwise reports `ALL DONE (tag) — N of M page(s) measured, each one counted.`
- **`next.mjs`** takes its denominator from the DECLARED site, prints a `?/N   NOT MEASURED` row for every page with no countable run (never `0/N` — an unmeasured page is not a page that scored zero), and exits 2 rather than reporting an empty backlog while a declared page has never been looked at.

`MATCH_HARNESS_PREVIOUS` is no longer empty. It shipped as `{}` under the comment "Empty at v1 — nothing has shipped", which was already false, and with an empty table the recipe FLAGS every installed site's copy as possibly hand-edited and never upgrades it — so this fix would have reached none of them. The generator now reads the bodies the committed template last shipped before overwriting them, and carries each changed recipe-owned file's old body forward.

**Behaviour change to expect:** `next.mjs` exits 2, where it used to exit 0 or 1, the moment a page in `harness.json` has no countable report anywhere under `matching/`. That fires as soon as a page is added to the table before it is gated, which is the point.

**Not covered:** there is still no candidate preflight — the entire 29 Navy reproduction was "the dev server is down", discovered only after a full browser launch per page; `strikes.mjs` still prints `strikes: clear` for a declared page that has never produced a report; and `TOTALS` still assumes the anchored region model, so an anchorless page scores against the wrong denominator.

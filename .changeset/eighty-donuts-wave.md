---
"@reddoorla/maintenance": patch
---

match-harness: `next.mjs` refuses to score a page with no anchors (#751)

`TOTALS[page]` was `(anchors.length + 1) * MATRIX.length` — an identity that
holds only for an ANCHORED run. Without anchors `page-diff` falls back to an
even four-row grid, so on the shape every new site starts in (`anchors: []`) a
fresh install divided a real pass count by an imaginary denominator: `SCORE
12/3 regions passing` on the default matrix, `16/4` on a matrix of four, then
`No open geometry failures` and `Backlog is empty — Phases 5 and 6 are what is
left`, exit 0. A site whose page-diff produced a grid nobody specced read as a
finished Phase 4.

`harness.mjs` now exports `scorable(key)` and gives an unanchored page
`TOTALS = null` rather than a plausible-looking integer. `next.mjs` keeps such
pages out of the ranking, prints the run's own region count as evidence for the
refusal (`home  12 region(s)  NOT SCORABLE — no anchors`), and exits 2. The
pass fraction is deliberately withheld. A fresh install now behaves like the
seed's `refMark: ""`: it refuses until Phase 1 is actually done.

Also fixed, and not visible in the issue: an unanchored page's `pass / total`
ratio is not bounded by 1, so a passing one sorted BEST and could never be
named the worst page, while a FAILING one sorted first and printed `NEXT:
<page> — worst page` with an agenda of `grid-0-0`, `grid-1-0` … — an
instruction to fix geometry against regions page-diff invented.

TWO THINGS THIS PATCH CARRIES THAT A PATCH NUMBER DOES NOT SUGGEST.

1. It is a patch by version number only. The recipe's scripts are copied
   verbatim from their source site, which has moved ~360 lines ahead of 0.95.0
   in `harness.mjs`, `gate.sh` and `next.mjs` — `uncountable`, `checkRun`,
   gate.sh's `--check-run` evidence call and next.mjs's `unmeasured` guard.
   Regenerating to fix #751 necessarily ships that drift too. It is all the
   same class of hardening, but it was never reviewed as a release.

2. Those three files upgrade as a SET. Measured both ways: a new `next.mjs`
   against an old `harness.mjs` dies with "does not provide an export named
   'uncountable'" — it does not degrade, it does not load; and an old
   `harness.mjs` given a new `gate.sh`'s `--check-run` prints its usage banner
   and exits 2, which gate.sh reads as NOT MEASURED for every page before
   printing GATE INCOMPLETE. `MATCH_HARNESS_COUPLED` plus a two-pass install
   make them move together or not at all, so one hand-edited script can no
   longer leave the others upgraded around it into a harness that cannot run.

MIGRATION. 0.95.0 is already published and installed, so a template-only fix
would have reached nobody: `planFileWrite` would `flag` every 0.95.0 file,
leave it broken, and add a note telling the site it hand-edited a file it never
touched. `MATCH_HARNESS_PREVIOUS` is therefore populated from
`scripts/match-harness-previous/0.95.0/`, extracted once from the tagged
template and verified byte-equal to a real install. An untouched 0.95.0 harness
now safe-replaces on a re-run of `reddoor-maint match-harness`;
`matching/harness.json` is site-owned and is never rewritten, so anchors,
matrix and refMark survive. A site that never re-runs the recipe keeps the old
behaviour — there is no push mechanism, and adding one is a fleet decision.

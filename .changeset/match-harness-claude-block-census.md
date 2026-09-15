---
"@reddoorla/maintenance": patch
---

match-harness: the installed CLAUDE.md rules name census.sh, so Phase 3 has a Check and a round-protocol step (#736)

The recipe installs `matching/census.sh` — the Phase 3 style gate, and the
only gate that catches an 11px footer line or a cyan-vs-teal link, which the
pixel diff is structurally blind to — and the rules it installs alongside never
mentioned it. On a fresh site the gate had no rule, no **Check:** line, no
operator's challenge and no place in the round protocol: the script was there
and nothing would cause anyone to run it.

Rule 4 ("a gate closes an item, nothing else") now carries a **Check:** that
`bash matching/census.sh <page>` exits 0, and the round protocol gains a step
between the gate and the LEDGER: a remaining row is fixed at its source or
declared in `matching/census-deviations.mjs` with a LEDGER line, never ignored.

This is the first block body the recipe has ever superseded, so it is also the
first entry in `MATCH_HARNESS_BLOCK_PREVIOUS`: the 0.95.1 body, sourced from
`git show v0.95.1` per that table's own rules. Without it every installed site
would have been flagged as hand-edited and kept the old rules. Measured with
the shipped table and no injection: a 0.95.1 site (terminated region) and a
0.95.0 site (marker-only region) both upgrade in place with the site's own
prose untouched.

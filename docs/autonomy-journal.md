# Autonomy run journal

A rolling, reverse-chronological log of every PR the agent merged
**autonomously** (see [`AUTONOMY.md`](../AUTONOMY.md)), so the whole arc is
reviewable fast — and any one change is easy to find and `git revert`.

One row per merged PR. **Class:** fix / feat / chore / ci / docs.
**Gate:** what cleared it (CI + the review that ran). Release PRs are
human-merged and are **not** logged here.

| Date       | PR                                                                | Class | Change                                                                                                                                 | Gate                                                        |
| ---------- | ----------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 2026-06-10 | [#150](https://github.com/reddoorla/reddoor-maintenance/pull/150) | fix   | `getWebsiteBySlug` filterByFormula (no per-request table scan, MEDIUM-H); formula verified against live Airtable; injection-guarded    | CI green + live-formula verify + full suite                 |
| 2026-06-10 | [#149](https://github.com/reddoorla/reddoor-maintenance/pull/149) | fix   | deps audit: guarded `JSON.parse` (LOW-4) + skip non-semver specs that yielded bogus drift (LOW-3)                                      | CI green + TDD (RED→GREEN)                                  |
| 2026-06-10 | [#148](https://github.com/reddoorla/reddoor-maintenance/pull/148) | docs  | Correct the sandbox scope to install-time containment (Seatbelt breaks the test suite → dev loop excluded); log #146/#147              | CI green                                                    |
| 2026-06-10 | [#147](https://github.com/reddoorla/reddoor-maintenance/pull/147) | ci    | Coverage floor (S78/B67/F76/L80) + clean-tree guard added to the required CI gate                                                      | CI green + 3-lens adversarial review (3 findings folded in) |
| 2026-06-10 | [#146](https://github.com/reddoorla/reddoor-maintenance/pull/146) | docs  | Autonomy contract (`AUTONOMY.md`) + this journal                                                                                       | CI green                                                    |
| 2026-06-10 | [#145](https://github.com/reddoorla/reddoor-maintenance/pull/145) | fix   | Airtable write-back no longer all-or-nothing on Lighthouse — a Lighthouse miss writes a11y/deps/security first, then throws (MEDIUM-E) | CI green + 3-lens adversarial review (3 findings folded in) |
| 2026-06-10 | [#144](https://github.com/reddoorla/reddoor-maintenance/pull/144) | fix   | `deployedLighthouse` timeout 3→5 min, parity with checkout (MEDIUM-F); live erp confirm = real scores in 107s                          | CI green + self-review (one-constant change)                |
| 2026-06-10 | [#143](https://github.com/reddoorla/reddoor-maintenance/pull/143) | fix   | a11y transient spec-dir: try/finally cleanup + `.reddoor-a11y-spec-*/` fleet-gitignored (MEDIUM-D)                                     | CI green + 3-lens adversarial review                        |

_Journal started 2026-06-10 alongside the autonomy contract. Earlier work is in
git history / the morning briefs under `docs/morning-reports/`._

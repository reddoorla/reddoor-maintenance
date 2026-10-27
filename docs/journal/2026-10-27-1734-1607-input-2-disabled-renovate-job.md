## 2026-10-27 (about 6:45am–10:40am PT) — #1607 input 2: a Renovate job that can never run reads DRIFT, after five review rounds and the operator's answer

Landed in this PR, reddoorla/reddoor-maintenance#1830. Decisions, in the workspace:

- `decisions/2026-10-27-1342-1607-js-yaml-runtime-dependency.md`: `js-yaml` may be a runtime dependency.
- `decisions/2026-10-27-1700-1607-runner-rule-at-round-5.md`: answered (a), one simple runner rule, land without a sixth round.

**Why.** `fleet-config-drift` read `CLEAN` for a site whose `renovate.yml` had `if: false` on the `renovate:` job. Cron, pins and App auth were all intact, so every string check passed while Renovate never ran. The cron there is the fleet's merge cadence, so a disabled job stops a site merging anything, silently. #1680 tried to catch it with a line scanner and split it out after six rounds of false gaps. This PR parses the file with `js-yaml` instead, and reads `if:` values the way GitHub does.

**The instrument came first.** #1607's 3:18pm UTC comment kept GitHub's own parser and evaluator (`@actions/workflow-parser` and `@actions/expressions` 0.3.61) and its verdicts on 112 `if:` values. I installed both in the scratchpad, never in the repo, and rebuilt the 336 placements (each value as the job's, the renovatebot step's and the app-token step's `if:`). The oracle gave the recorded verdict on all 336 before any test was written, so every corpus test rests on a proven instrument. The comment's script imported `@actions/expressions/dist/result.js`; under that package's exports map it is `@actions/expressions/result`.

**Beliefs corrected on contact.**

- js-yaml's value is not what GitHub evaluates. For `|-` and `>-` block scalars, and for quoted scalars over two lines, js-yaml yields exactly `${{ false }}`. GitHub keeps the source text, indentation or quotes included, and builds a truthy `format()` string, so the job runs. A listener on js-yaml's node events marks those strings. Round 1 then found that a comment between `if:` and the block header defeats a naive prefix test, because js-yaml opens the node before it skips the comment.
- `${{ 'false' }}` is skipped: GitHub unwraps a lone literal to its text. #1680's tests had expected no gap there, and the oracle overruled them.
- tsup externalizes devDependencies as well as dependencies. So a dev-only `import` builds and packs fine and fails only in a consumer's install. smoke-dist's existing blocker covers ten named packages, not every devDependency. A new hook, `scripts/dev-dep-blocker.mjs`, runs the built `sync-configs --dry` with every devDependency unresolvable. It is the only test that catches mutation 5 (js-yaml back in `devDependencies`); vitest stays green under it.
- `RENOVATE_TOKEN` is a retired name with a guard. My round-3 env fallback named it twice more and `tests/build/retired-renovate-token.test.ts` failed (count 4, pinned at 2). The fallback only changed which reason an existing gap gave, so it came out.

**Defects the five review rounds found** (Opus reviewers, two or three lenses a round; every round was dirty):

1. **Round 1:**
   - Two false gaps: the comment-before-header case, and a multi-line quoted template.
   - An exponential regex: 40 `!` characters in an anchor took over 100 s.
   - A quadratic number token: 20,000 digits took 1.1 s.
   - Five rules a mutant could break with no test going red.
2. **Round 2:**
   - A false gap from a token fallback: `steps.app-token.outputs.token || secrets.X`.
   - A false gap from Renovate run another way.
   - Steps read in quadratic time: 80,000 aliases took 66 s.
3. **Round 3:**
   - The round-2 "another runner" rule (any mention of "renovate" means no verdict) hid the brief's own gap behind `echo renovate done`.
   - Narrowing it to a command parser then missed `npx renovate@41.0.0`.
4. **Round 4:** the parser missed the ghcr image, `yarn renovate`, `sudo -E renovate`, `bash -c` and quoted words. Each was reproduced, so it counted as a defect even when labelled minor.
5. **Round 5:**
   - The parser still had reproduced false gaps through the built CLI: `timeout 50m npx renovate` beside a disabled action step read `DRIFT`.
   - A validator action hid the brief's gap.

**What was abandoned.** The shell command parser (`runsRenovate`, about 60 lines over rounds 3 to 5). Every round found a new shell form it read wrong, and each wrong read was a false gap. The operator's answer replaced it with one rule. Any live step other than the action that mentions Renovate means no verdict. That cannot be a false gap whatever the shell form; it misses when another live job only names Renovate. Reviving the parser would mean accepting a moving list of shell forms. The PR body lists the known misses (`'''''`, `success() && false`, `${{ NaN }}`, contexts).

**Measured.**

- The code agrees with GitHub on 333 of 336 oracle placements. The 3 are `'''''`, unterminated by the YAML spec, which js-yaml rejects and GitHub reads as `''`.
- The final mutation set: all five of the brief's mutations went red (65, 216, 17 and 4 tests for 1 to 4; smoke-dist for 5), plus eleven of my own.
- The token-index timing test fails at 9.9 s against its 3 s bound with the index and its cache both removed. On the final code it passes.

**Honest accounting.**

- **Full suite:** green apart from `tests/scripts/dropbox.test.ts`'s proxy re-exec test. That fails the same way on origin/main here, because the container has Node 22, not the pinned 24.
- **Polluted runs:** four of my full-suite runs overlapped my own red-first test edits and do not count. Only the frozen runs on d82cd10c and 97ad6cac do: 11,772 passed on 97ad6cac, smoke-dist OK, and mutation 5 re-confirmed red there.
- **Restarts:** the worker restarted twice and the canary was refused each time. After the first, a smoke-dist edit doubled a half-applied block, which reading the file back caught.

Usage: $34.45, 922/419141 tokens, 76352970/1926639 cache, rate limit allowed_warning (cumulative for the session, read at 10:34am PT)

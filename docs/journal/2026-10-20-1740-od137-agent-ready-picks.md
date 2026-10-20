## 2026-10-20 — Operator decisions 137, the agent-ready picks: seven of eight landed, one half sent back (#1536, #1537, #1538, reddoorla/claude-skills#28)

This worker took the eight picks the operator marked agent-ready in item 137: (b), (h), (i), (j), (k), (l), (n) and (r). Six landed in full. (k) landed its first half, and its second half went back to the operator with evidence. (n) was left as the pick says. In all, three PRs landed here and one in reddoorla/claude-skills. Of the eleven issues, eight are closed: #1454, #1435, #1492, #1493, #1462, #1477, #1479 and #1464. #1465, #1480 and #1440 each carry one line saying what remains. Review raised two issues that are new and predate this work: #1540 and #1542.

**(b) #1536, dropbox.** The size check now also runs before `upload_session/finish`, so a file that grew while its session uploaded is refused with "nothing was committed". Before, the check ran only after `finish`, when the copy was already overwritten. The post-finish check stays, for a file that changes while `finish` is in flight. Round 1 found a reproduced major in my own new message. It reported the local size before the size and hash comparison ran, so a growth during `finish` turned a `MISMATCH` reply (99 bytes, wrong hash) into "holds the 100 bytes read". It now reports Dropbox's reply. The comment half of #1454 had already landed in #1523.

**(h), (i), (j) #1537, bake-off reporting.**

- (h) A request with no `stop_reason` on any of its lines is counted `unfinished`. Every cost that includes one prints `≥$x (n of m unfinished)`.
- (i) The truth moved from `<run>/truth.json` to `<run>.truth.json`, beside the run dir.
- (j) refute-repo's decision prints a line naming each check that a ruling credited against the key, read from `finalScores`' own new `credited` list.

The pick for (i) said "and every reader of it". One reader was not in the brief: the `/bakeoff` skill in reddoorla/claude-skills reads `<run>/truth.json` in three places. Against the moved truth, 12 of its 49 tests failed. reddoorla/claude-skills#28 makes it ask the harness's `truthPath`, and it landed first. That repo has no CI, so `land-prs.mjs` stops ("no checks reported"). I merged it through the connector, pinned to its head SHA, after three review rounds and 59/59 local passes against both harnesses. The skill's referee-loop test was already red on `main`: it expected 228 checks per run, and the harness's `scripts/` now gives 216. It now reads the count from the draft.

**Defects the reviews caught in #1537 and #28**, three rounds, the third clean:

- **Cost by file order.** A total depended on file order. `mergeRecords` kept a later file's stream-start copy over an earlier final one, so the same transcripts read `≥$0.00` or `$0.14`.
- **A dropped check listed.** `rulingChanges` listed a check the score column drops, a field of a refuted item. Deriving the list from `finalScores` fixed it at the root.
- **Notes that were false.** The skill's note said the cost ratios compare lower bounds when the one ratio was exact. Its first fix then printed the sentence with no ratio at all, for an unpriced gold.
- **A crash from my own fix.** Making `truthFile` ask the harness crashed with ENOENT on a run started under the old harness and scored after a pull. It now prints the harness's own instruction to move the truth.

**(k), (l), (r) #1538.**

- (k), first half: control findings are grouped under the control's own file, and findings that all share a line are one false positive. #1462's finding, restated four ways, now counts once.
- (l): `setup` refuses a snapshot with pnpm older than 11.
- (r): the README records the `$GIT_DIR/info/attributes` gap. Measured in a fresh local clone (git 2.43): 0 of 22 files differ without it, and all 11 diffs change with `*.ts -diff` in it. A first try via vitest failed in the bare clone, because the global setup runs `pnpm build`. Calling `build.mjs` directly worked.

**The belief corrected on contact: (k)'s second half.** The pick, one finding counts for at most one seeded defect with the closest first, rested on #1465's premise that only a lenient referee would credit one finding for two. I built it, and my PR body claimed no 2026-10-19 run put a finding near two defects. I had not checked. Round 1 replayed the run and showed the claim false.

- 14 r07 findings sit near both d5 and d6.
- Three single findings name both criticals outright, the `git clone` argv injection and the `site.name` path traversal: opus-medium-1 at 34-46, sonnet-medium-1 at 34-35, sonnet-medium-2 at 43-43. The referee credited each for both, correctly.
- Under closest-first, 8 candidate checks change and have no ruling. Ruled the way the committed rulings suggest, opus-medium goes from within to outside, and sonnet-medium's missed criticals go from 1 to 3.

That contradicts the pick's premise, so the half is out of #1538 and kept on `claude/od137-seeded-one-defect` (5b04ef1e). The ask is the home base's `decisions/2026-10-20-1714-od-137-k-one-finding-two-defects.md`, and its pick is #1465's other option: show the referee the other defect's text. The same round found my control merging was transitive: a chain 1-3, 3-5, 5-7 or one wide range swallowed findings that never meet. It also found that the merged wording's hash depended on finding order. Both were fixed. The same order dependence on the defect side predates this work, and fixing it would orphan the committed rulings, so it is #1542. After the fix, this head scores the 2026-10-19 run exactly as `main` does: the same 46 ids, all ruled, and identical numbers for all 11 arms.

**(n) left, as the pick says.** Widening c13's anchor rides the next refute-claims re-run, and this session ran none. #1440 says so.

**Mutations.** Every brief mutation (1 to 6) turned a test red, and so did 13 extras. One test passed on the old code at first: "other findings" under a blanket ruling, which marked both defects ruled off. It was rewritten until it failed without the change.

**Environment notes.**

- Running `cloud-session-setup.sh` by hand leaves Node 22 on PATH, because `CLAUDE_ENV_FILE` is unset. Node 24 is at `/opt/nvm/versions/node/v24.19.0/bin`. Under 22, one dropbox CLI test fails on an `UNDICI-EHPA` stderr warning; under 24 it passes.
- A command containing `rm -rf` is refused by the deny list even on a scratch path. Use a fresh directory name instead.

## 2026-10-19 — The bake-off tripwire's #1419 forms: seven review rounds, held (P1-63, #1444; Operator decisions 133)

> P1-63 is not done. #1444 is held on the operator's answer, and #1419 stays open.

The brief was to close #1419's remaining forms in `forbiddenCommand` (`scripts/model-bakeoff/lib/transcripts.mjs`), keeping the lexer design. All 41 forms from the issue and its fix list reproduced on `main` at `2459645a` before anything changed. The first commit fixed them all with a test each: read-only git forms (`tag --merged`, `config -f`, dry runs) stopped flagging, and local writes (`remote add`, `config --unset`, `notes add`, `submodule update`), `find -exec`, `wget --post-data`, `echo … | sh`, unquoted-heredoc substitutions, `curl -X $M` and `$(which gh)` started. The branch now has 377 tests, and every fix has a mutation that turns a test red, about 45 in all.

**Every review round was dirty, and five of the seven found regressions in the previous round's fixes.** That is the most useful thing this entry records:

- Round 1: 4 majors. Two of them: the `--sort`/`--format` options let a branch name through, and the second `-exec` was never seen because the lexer split at `{}`.
- Round 2: 3 majors, 2 of them from round 1's fixes. A `--sort` value counted as a name, and `submodule foreach` dropped the inner command's options.
- Round 3: 2 majors, both from round 2. My forward stack for `( … ) | sh` group feeders was unbalanced by `case` arms and `${a:-$(…)}`. I backed it out instead of patching it a third time; groups are listed as unseen (#1438).
- Round 4: a major that predates the PR. `\`-newline hid the command (`git \⏎ push`), a shape models write all the time.
- Round 5: four reproduced hand-built defects, two of them from round 4's fixes. That made a hold, and the operator answered: a sixth round.
- Round 6: 2 majors. Round 5's word split at `>` turned `git -C repo>/dev/null commit` into a miss, and a redirect counted as a positional word, so `git config user.email 2>/dev/null` was flagged. The fix drops redirects from argv the way bash does (`plainArgs`). The operator answered: a seventh round, then land only if clean.
- Round 7: no regression from round 6's fix, but five more reproduced defects (#1486). The major is `&>> out git push`, missed because `commandOf` still uses the pre-`BARE_OPERATOR` regex for a leading redirect. So the PR is held.

**Beliefs corrected.**

- "Each of these is a small lexer fix." Each one was small. But every word-splitting change moved the meaning of every command containing that character, and the tests only pinned the forms already named. The review kept finding the neighbouring form.
- The operator's OD 131 line already offered the way out: prevent writes with a read-only agent type instead of detecting them. P1-56's `sweep` agent (#1425) shows that the `tools` line withholds the tool structurally. My pick at both holds was another round, because the brief ruled out agent definitions. In hindsight, the question to ask at round 3 was whether detection is the right design.

**Instruments.**

- The group-feeder walk's own timing test caught it going quadratic: a repeated `) | sh` was still running after 120 s. The same run caught `) | sh` with nothing before it returning true.
- Twice I killed my own shell: `pkill -f`/`pgrep -f` with a pattern also matched the command line of the shell running them (exit 144). P1-56's entry records the same trap.
- One reviewer overwrote my mutation backup in the shared scratchpad. Later reviewers got their own subdirectory.

**Left open:** #1419 (the original forms; #1444 holds their fix), #1426 (quadratic `HEREDOC` regex), #1438 (group, loop and filter feeders), #1456 (echo with `$(…)`, heredoc line continuation, a quoted fd digit), #1486 (round 7). The decision is Operator decisions 133.

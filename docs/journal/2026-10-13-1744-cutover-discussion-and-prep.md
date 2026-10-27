## 2026-10-13 — The cutover talked through, a deny-list gap found in this session, and four prep workers run (#1337, this PR)

A discussion session with the operator about the workspace-and-maintenance split turned into a prep run once he asked for "the questions you need and workers to clear everything else before the cutover".

**Something new was measured in this session itself.** It started in maintenance, called `add_repo` for reddoor-workspace (which added it to the session's sources), and was then restarted. It came back as a multi-repo session: `get_session` listed both repos, and the cwd was `/home/user`. The workspace `CLAUDE.md` loaded on its own. Arm c never saw that, because arm c never restarted. But no deny list applied. `rm -rf /tmp/deny-canary-absent` ran with rc=0, and the auto-mode classifier refused bare `git stash` (`[Irreversible Local Destruction]`), not a deny rule. The cloud docs say only a single-repo session reads `.claude/settings.json`. So the gap is not only a cutover risk. Any attach-then-resume session has it today, the all-day cockpit included. Until 10-13, the plan's probes had measured only the turn after an attach, never a restart.

**What the operator decided** (Operator decisions 121): probe an environment-level deny list and keep the canary on every resume as the fallback; the workspace keeps its own `journal/`; the cutover is Fri 10-23, with the Mon 10-26 scheduled fire as its proof. In a second round, after the workers finished: W1's setup block goes in during the window, not before; a0 and a1 are dropped; W4's four keep-or-drop picks are accepted.

**The four workers** each started single-repo, the shape whose deny list is measured. They spawned at 13:50Z, all finished by 15:07Z, and cost about $34 together, about $18 of it W2.

- W1: user-level settings apply with two repos under the cwd and stack with the repo file. A known-good arm and a negative-control arm both behaved as expected. The instrument was local headless `claude -p`, not a live cloud restart, so the window's live check is what proves it.
- W2: `scripts/decisions.mjs` landed (#1345).
- W3: `evening-branches.mjs` landed (#1338); the loop is staged on workspace `cutover/loop`, draft #1347 holds the pointer files, and the runbook is on workspace `main`.
- W4: the home-base `CLAUDE.md` at 98 lines, with a map that a script checks, on workspace `cutover/claude-md`; draft #1342 slims maintenance's.

**Beliefs corrected.** The cutover plan assumed an attached repo's `CLAUDE.md` never loads (arm c). After a restart it does. The deny list is what drops instead. Both are true at different moments of the same session, which is why the home-base `CLAUDE.md` now carries both the explicit-read rule and the canary-on-resume rule. Separately, the operator chose to type a0's and a1's turns himself, but both sessions had already been archived. Asking "will you run it" without first checking that the sessions could still take input was this session's miss.

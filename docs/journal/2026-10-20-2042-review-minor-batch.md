## 2026-10-20 — The evening review-minor batch: four PRs for fifteen issues, half of them already done (this PR, with #1551, #1552, #1557)

Worker brief `briefs/2026-10-20-review-minor-batch.md` in the workspace, decision `decisions/2026-10-20-1924-evening-queue-four.md` (d). Fifteen issues were in scope, all open at 19:27Z.

**The brief's list was stale, and the issue states could not say so.** The 10-19 overnight batch (#1522–#1528) had already fixed six of them, but marked each "Part of", so they stayed open. #1457 was wholly fixed by #1524 (977bf14e) and is now closed. #1451(1) was fixed by #1528; its item (2) needs no change, so it is closed. #1468 items 2–4 were fixed by #1522 (f32ef907). #1471's runbook items were fixed by #1523. #1474(1) was fixed by #1528. #1512's vitest-workers nit was fixed by #1524. Four workers found this only after building worktrees, so about ten minutes of each went on rediscovery. The check that would have caught it is `Part of #n` in the merged PRs' bodies, not the issue's state. A pass that queues "open minors" should read the last batch's PR bodies first.

**What landed:**

- #1552 (#1515). The live a11y suite pins the `none`-specific remedy again. It does so with a faked `color(--brand 0.205 0 none)`, which axe 4.14 still rejects; the remedy is chosen from the colour string axe reports, so the stand-in reaches the same branch. Deleting the `/\bnone\b/` branch turns it red. One review round, minors only.
- #1551 (#1447, #1448). `protectionPutBody` now refuses, with a typed `ProtectionRefusedError`, to send back a dismissal restriction that lists nobody, because GitHub reads an empty object as "disable". Proved on fixtures only, never a live call. Three rounds:
  - Round 1 (major): the throw skipped the admin-binding ruleset step for that repo, so the recipe now records the refusal, runs the ruleset step, then fails the repo.
  - Round 2 (major, reproduced): a later ruleset failure hid the refusal, so the refusal now leads the note.
  - Round 3 was minors only, folded in.
  - #1448's app pinning is kept (stricter than "any app") and is now documented.
- #1557 (#1512). The detached-server fixture no longer races its own 4 s timeout. It catches the spawn's timeout callback and fires it once the server's pid file appears. Under load (4 copies plus 8 busy loops, timeout 150 ms) the old fixture failed 18 of 24 runs and the new one 0 of 24. The two tests went from about 4.2 s to 0.2–0.5 s. It had not actually flaked in the 109 CI runs since #1510.
- This PR (#1408–#1411), on the security audit's merged pnpm-12 branch. It now audits dev scope too, which is the Dependabot-parity rule: a dev-only direct high now fails these sites and can trigger the Renovate dispatch. It dedupes within one module by GHSA, then CVE, then title. It appends only the ghost clause. It counts each severity as the larger of the deduped advisories and pnpm's metadata count.

**Belief corrected on contact: a dedupe is a merge.** The first version of #1409 dropped the second copy of a duplicate. Four dirty review rounds then found the ways that loses information, each a reproduced input:

- one GHSA covering two packages (`babel-traverse` and `@babel/traverse`) collapsed into one, transitive;
- a Dependabot high folded into a pnpm moderate read `warn`;
- an npm entry carrying two GHSAs absorbed two different advisories;
- Dependabot's `scope` was dropped;
- Dependabot's "transitive" filled pnpm's deliberately unknown relationship in a workspace;
- a runtime alert merged after a dev one read "(dev)".

Each one made the result read safer than the truth. Round 5 was minors only. What remains: within one severity, the count can read low when pnpm's detail-less count and the merged advisories are different vulnerabilities (pnpm `{critical:1, high:1}` with detail only for a vite high that Dependabot rates critical reads 1C; the truth is 2C). It is never zero where either side has one, so the status never changes, and the code comment says so. The rule that came out is the one to reuse: when two sources describe one advisory, every field takes the worse of the two (higher severity, direct over transitive, runtime over development), and "unknown" is kept unless both sources know.

**Found and filed, not fixed:** #1561 (major, on main before this PR). A pnpm-12 repo whose lockfile audit cannot run (pnpm and npm both missing) returns `skip` alone and drops Dependabot's live alerts, so a live critical leaves the row's stale counts in place.

**Left with the operator or open:**

- #1450 (null status in launch-check): `decisions/2026-10-20-1930-launch-check-null-status.md`.
- #1468(1) (a capitalised `TODO Ship …` ask passes): `decisions/2026-10-20-1930-decisions-todo-capitalised-ask.md`.
- #1474(2), the rate-limit key: an operator question.
- #1471(1)–(2): need a measurement of what the upload page retries, and Chromium.
- #1452: not taken. Item 1 edits the model-bakeoff README, which a fresh branch was also editing; P1-55 is live there; items 4–5 edit the frozen BACKLOG.

**Process notes.** shepherd's reviewer agent could not run its own lenses here: its context script calls `gh pr view` (GraphQL, refused by the proxy), and it had no agent-spawn tool. General-purpose reviewers on the session model, given the diff commands, worked and reproduced every major they reported.

# 2026-11-19 — P1-117: pre-approve reports up to a week early

In reddoorla/reddoor-maintenance#2156 (issue #2149). Brief: workspace `briefs/2026-11-19-p1-117-pre-approve-reports.md`.

The operator asked, Thu 11-19 about 9:55am PT, "can we set up pre approving drafts? and lock the data to the approval (limit to a week ahead of time)", and answered two forks. He chose **hold to due date** for when an approved report sends, and **the due date** for the date its email shows. Approving early would otherwise send early, and the next due date is counted from the send, so every site's cycle would creep earlier. Holding the send to the due date keeps the schedule exactly where it was.

What it does. The nightly drafts up to 7 days before the due date (`DRAFT_LEAD_DAYS`) and stores that date on the row (`reports.due_on`, migration 0058). `--send-ready` skips an approved row until the Pacific date reaches its `due_on`, logging `• held (…)`. It compares the Pacific day because the send's fallback cron can start after midnight UTC while it is still the evening before in Los Angeles. The test that pins this sends at 11:30pm PT on 11-20, when the UTC date is already 11-21. The email and its subject month are dated `due_on` (`emailDate`). The cockpit names the send day ("approved, sends Sat 11-21, 8:07am PT"; 9:07am in PDT).

Approval already froze evidence, Search Console, Lighthouse scores and GA. The header plate was the one client-visible thing it did not freeze. The plate is site-wide, the send reads it when it sends, and every draft and every `announce` replaced it. With approval up to a week ahead, a Testing draft or an announcement in that week would have changed the screenshot on an approved report. `refreshHeaderUnlessHeld` now keeps the plate while an approved, queued report for the site is unsent. `header-image --write-back` is left unguarded on purpose.

Live state at about 10:40am PT, from a read-only Turso query: no unsent drafts anywhere, so no existing approval is affected. The only reports due within 7 days are CalTex and MSOT, Sat 11-21.

## Beliefs corrected on contact

- **"A Testing push can move a drafted row's due date inside its period."** Round 1's reviewer reasoned this way, and I built a nightly `due_on` re-patch on it. Round 2 showed `pushPastTesting` always lands at least one cycle later, so a push lands in a later period and never reaches the row. In-period moves come only from an anchor edit before the first send, or a manual same-type send. Round 3 then showed the re-patch was harmful once the email was dated by `due_on`: it moved the send's date without re-rendering the stored preview. So a ready row now keeps its drafted date. The anchor-edit cost is filed as #2157.
- **"My local typecheck was clean."** It was not. I piped `pnpm typecheck` through `grep -E "error|…"`. When svelte-check is not on a TTY, it prints `ERROR`/`COMPLETED … N ERRORS`, so the grep matched nothing and I read silence as a pass. CI's `build` caught four errors: two cockpit fixtures without `dueOn` and a parameter type in my new test. I now check by exit code. This is the workspace's "prove the instrument" rule, met again.
- **"Mutations 14 and 15 survived."** They had not. The mutation worktree had never run `cockpit:sync`, so every cockpit test failed to load. After syncing, both went red. Later, mutation 20 also looked like a survivor: its first form (`?? null ??`) did not compile, so the global build failed, and my script read "no ✗ lines" as green. In its compiling form it went red. Only reds that name a failing test count.

## Measured

- 21 mutations stand, all red, each naming its failing test; the table is in the PR body. A 22nd covered a cockpit history-column change that round 4 reverted. The brief's six are 1–6. Two of the six cover the Pacific-day comparison and the next due date being counted from the send rather than the approval.
- Review: 4 rounds (Opus). Rounds 1 and 3 were dirty; rounds 2 and 4 found minors only. Filed: #2153, #2154, #2155 (settled by round 3), #2157, #2158.
- Full suite: 14,019 passed and 1 failed on the first run. The failure was a P1-87 ticker drag test, statistical ("5 of 10 runs"). It took 29.4s under a parallel mutation run and passed alone in 12.2s. Its files are not in this diff.

## Test changes

Three existing assertions moved their dates because the 7-day window changes what they pin: in `due.test.ts`, the "future" case and "overdue catch-up"; in `report-command.test.ts`, the "same-period withdrawn row" case. The migration lists gained 0058. Nine page-data snapshots gained `"dueOn": null`. Fixture factories gained `dueOn: null`.

Usage: $12.21, 1880/99478 tokens, 36014080/440477 cache, rate limit allowed

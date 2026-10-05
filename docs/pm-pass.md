# The daily PM pass

A scheduled Routine ("Reddoor Project Manager", Monday to Thursday) starts a
fresh cloud session and gives it this file. Its cron is `48 11 * * 1-4` with no
time zone, which is UTC: 04:48 PDT, and 03:48 PST once daylight saving ends on
2026-11-01 (read from `list_triggers` 2026-10-05; this line said "every day"
until then). The evening pass, below, is a second Routine on the same file. The session's job is to
**prioritize, not build**: it re-checks `docs/BACKLOG.md` against the live
state of the fleet and this repo, re-ranks it, writes the day's morning
report, and lands one docs-only PR. It does not write code, dispatch fleet
workflows, or send anything to a client.
Worker sessions, started by the operator, pick items off the backlog.

The prompt lives here so it can be changed by PR, like everything else.

## Rules that bind this session

1. Read `CLAUDE.md`, `AUTONOMY.md` and `docs/BACKLOG.md` first. Every rule
   there applies: work in a worktree, never commit from the main checkout,
   prove an instrument before trusting its verdict, and append a journal entry.
2. **Docs only.** The PR may touch `docs/BACKLOG.md`,
   `docs/morning-reports/MORNING_REPORT_<date>.md`, `docs/workJournal.md`, and
   this file. If a code fix is obvious, write it up as a backlog item with a
   "start here" and leave it for a worker session.
3. **Never dispatch `daily-reports`** (`--send-ready` emails clients) and never
   dispatch `fleet-security` (it fires `renovate-dispatch` in client repos).
   Dispatching nothing is the default; a `fleet-smoke` dispatch is the one
   safe exception, and only to prove a fix already on `main`.
4. **Claim before triaging.** A red nightly has an auto-filed tracking issue.
   Read it for an existing claim before writing anything about it. Record the
   claim in the backlog; do not take the item.
5. **Respect worker claims.** An issue with a fresh claim comment or a fresh
   `claude/*` branch belongs to that session. Rank it, do not re-plan it.
6. **Land with `node scripts/land-prs.mjs <pr>`** from a worktree detached at
   `origin/main`, after CI is green on the head you read. Push only to the
   branch the harness assigned to the session.
7. **Time budget: about 45 minutes.** The nightlies fire 3–8 h after their
   cron minute, so some will still be pending at 05:00 PT. List them by name
   as pending; do not wait for them.

## The pass, in order

1. **Nightlies since the last report.** `gh api "repos/reddoorla/reddoor-maintenance/actions/runs?per_page=100&created=<yesterday>..<today>"`
   filtered to `event == "schedule"`. For each fleet run, read the job log for
   its `FLEET_WRITE_SUMMARY wrote=N failed=M total=T` line; a green run with
   `failed>0` is not green. Note which tracking issues opened or closed.
2. **Reports due in the next 14 days.** Run the pre-send gate the way
   `docs/runbooks/continuity.md` describes and list each due report with its
   blockers, in date order. This is the operator's top-of-stack.
3. **PRs.** Every open PR: author, age, CI state, mergeable state, and whether
   it is a release PR (`chore(release): version packages`, always the
   operator's). A Renovate PR that is green and unmerged is usually a rule
   working (`automerge: false` on `@reddoorla/maintenance`); name the rule
   before calling it stuck.
4. **Issues.** Everything opened, closed or commented since the last report.

   **Discord open asks** (part of step 4). GET only, never post: the bot token is
   `DISCORD_BOT_KEY`, guild `1199077765144662046`, REST at
   `https://discord.com/api/v10`. For each text channel with a message in the
   last 14 days, read its recent messages and list every message that
   mentions the operator (`tucksravin`, user id `214787673846579200`) or asks
   the operator something by name, where the operator has neither replied
   after it in that channel nor left **any reaction** on it (the operator's
   rule since 2026-09-29: any reaction from the operator closes the ask).
   List asks older than two days under "Waiting on you (Discord)" in the
   morning report: channel, who, date, and the ask in one line. Do not quote
   credentials, codes, addresses or phone numbers that appear in messages.
   There are no clients in the guild; everyone in it is Reddoor staff.

5. **Backlog diff.** For each P0/P1 item: still true? done? claimed? Move done
   items to the Done section with the PR number. Add what the day's evidence
   surfaced. Re-rank. Update the "Last full re-rank" line. Read every line
   added under "Operator decisions" since the last report: workers write their
   stop-condition questions there instead of asking (`CLAUDE.md` → "Worker
   sessions never ask mid-flight"), so each new line goes into the morning
   report's top of stack with the branch or PR it names. Then run
   `node scripts/evening-branches.mjs --repo reddoorla/reddoor-maintenance`
   (see "The evening pass") and lift every ask it finds only on a branch, in
   the same way. A worker that writes its ask only on its own branch is
   invisible to a read of `main` (#1143, 2026-10-05).

   **[H] items** are the ones the operator builds by hand. Rank them with
   everything else, but list them in their own "Yours to build [H]" section of
   the morning report, never recommend a worker for one, and never write a
   brief for one. A worker that finds an [H] item already started by the
   operator leaves it alone, as it would another session's branch.

6. **Morning report.** Copy the shape of the most recent file in
   `docs/morning-reports/`: one-line verdict, top of stack for the operator
   (dated, ordered), what landed, nightlies, what went wrong, next for agents.
   Every number in it comes from a query or a log line made that morning.

   **The clean-send streak.** Read the table under "Clean-send streak" in
   `docs/BACKLOG.md` and put one line near the top of the report: "clean
   [TEST] sends in a row: N", counted up from the table's last row. Each
   `awaiting` row is an ask in the operator's top of stack: "Verdict on the
   [TEST] <site> <report> sent <date>: clean, or what was wrong". Never
   write a verdict yourself; only the operator can see what the email looked
   like.

   **Next for agents ends with briefs.** For each item you recommend starting
   today (one to three, none of them [H], none claimed), paste a filled-in
   brief from `docs/worker-brief.md` under a "Briefs" heading, ready for the
   operator to copy into a new session unchanged. Re-run the item's _Verify_
   line and re-read its "start here" lines before writing the brief, so the
   line numbers in it were measured this morning. An item whose brief would
   need an operator decision is not ready: put the decision under "Operator
   decisions" instead.

7. **Journal entry**, then the PR, then land it.
8. **Finish by posting the one-line verdict and the operator's top three
   items** as the session's last message, so the notification carries them.

## Mondays: the heavier pass

On a Monday the pass does three more things, inside a budget of about 75
minutes instead of 45:

- **Fresh reads, not a diff.** Every open issue, not only those touched since
  the last report, and the live fleet state from Turso (SELECT only): row
  counts by status, cockpit attention and watch, staleness of each sweep, and
  unread form submissions. Rewrite BACKLOG's "Fleet snapshot" from them.
- **Refute the week's claims.** Run the `refute-claims` skill over the
  morning reports from the previous seven days. Every [M] claim in them was
  measured once and then carried forward; this is the one place a wrong one is
  caught. A refuted claim gets a forward pointer in that report (the one edit
  an old document may take, as in the journal rule) and a corrected line in
  today's.
- **Full re-rank.** Re-order P0/P1 from scratch rather than editing the
  previous order, and say so in the header's "Last full re-rank" line.

## The evening pass

A second Routine ("Reddoor evening pass", 17:18 America/Los_Angeles, Monday to
Thursday) starts a fresh cloud session at dinnertime and gives it this file.
The operator reads its one notification, then at most the day's `## Evening`
section, then stops: ten to fifteen minutes. The morning pass ranks the day;
the evening pass answers one question, **what needs the operator before
tomorrow morning that the morning report could not see?** Most of the day's
nightlies, the `daily-reports` drafts (about 15:00Z) and every worker
session's ending all happen after the morning pass has finished.

It exists because of three misses on 2026-10-05. A worker held #1143 and
wrote its question only on its own branch (`claude/wizardly-brown-2ylvcv`),
so `main` asked the operator nothing for 13 hours. Another session left
docs commits on `claude/jolly-keller-9h8tzh` with no PR. And at 12:00Z every
nightly was still pending, so the morning pass could not report any of them.

### Rules that bind the evening pass

1. Everything under "Rules that bind this session" above applies, except
   that the pass is **read-only** apart from one docs-only PR. That PR may
   touch only today's `docs/morning-reports/MORNING_REPORT_<date>.md`, where
   it appends a `## Evening` section, and `docs/workJournal.md`, where it
   adds one line, not a full entry. It never edits `docs/BACKLOG.md`: it
   lifts what it finds into the report, and the next morning pass re-ranks.
2. **It never acts on what it finds.** It does not open a PR for an
   unprotected branch, comment on a worker's PR, re-run a job or merge
   anything. Each finding becomes an exact ask in the evening section, and
   the next morning pass carries any that are still open. If no morning
   report exists for today (a Friday, or a pass that failed), it writes
   `MORNING_REPORT_<date>.md` containing only the `## Evening` section and a
   first line saying so.
3. **Time budget: about 20 minutes.** It reads, it does not investigate. A red
   nightly gets its name, its `FLEET_WRITE_SUMMARY` line and its tracking
   issue, not a diagnosis.
4. **The branch and decision checks are a script, not a reading.** Use
   `scripts/evening-branches.mjs`. It was proven on 2026-10-05: it flags both
   branches above, and it passes a squash-merged branch (#1153) and a fully
   merged one (#1151). Do not replace it with a grep: a literal
   `Operator decisions` grep of #1143's diff hits the phrase only in its
   journal lines. The held ask sits in item 57's sub-bullets and never names
   the section it is in.

### The evening pass, in order

`<since>` is the time today's morning PR merged (`merged_at` on the PR that
added today's morning report). If no morning PR merged today, use 12:00Z.

1. **Branches and decisions.** From a worktree detached at `origin/main`:

   ```sh
   node scripts/evening-branches.mjs --repo reddoorla/reddoor-maintenance --main-since <since>
   ```

   It fetches every `claude/*` and `fix/*` branch whose last commit is within
   seven days, and prints one `EVENING_BRANCHES_SUMMARY` line followed by
   these sections:
   - **Lines added under "Operator decisions" on `main` since `<since>`.** These
     are every decision line workers landed today. Each new ask goes in the
     evening section, with the PR it came from.
   - **Asks only on a branch.** A branch that is neither merged nor at the
     head of a merged PR, and that adds an `_Ask:_`, `_Pick:_` or question
     line under "Operator decisions" which `main` lacks. This is failure 1.
     Lift each ask into the evening section word for word, with its branch
     and PR. When the script adds "already names this branch", `main`
     already carries the ask, usually paraphrased by an earlier pass. Write
     "already item N" and leave it at that. Lines that sit only on a branch but carry no ask are status
     notes. Mention them only if their branch is also unprotected.
   - **Unprotected branches.** Commits not on `main` (`git cherry`, so a
     rebase-merged commit does not count), no open PR, no merged PR at the
     tip, and a last commit at least 2 h old. This is failure 2. `NEW` means
     the last commit is under 36 h old. List each `NEW` one with its commit
     subject and the ask "open a PR from it, or say it can go". The `older`
     ones are known residue: give their count and names in one line, and do
     not repeat the ask nightly.

   **Prove it first, every run.** The summary line must show `scanned` > 0. A
   `gh api` failure stops the script with an error; it never reads a failure
   as "no PR". If the script errors, the evening section says so, and the
   notification headline is "evening branch check failed: <error>", never
   "nothing needs you".

2. **Nightlies since `<since>`.** As in the morning pass, step 1: every
   `event == "schedule"` run created today, each fleet run's
   `FLEET_WRITE_SUMMARY wrote=N failed=M total=T` line read from its job log,
   and every tracking issue opened or closed today. List any run still
   pending by name. A green run with `failed>0` is not green.
3. **Today's `daily-reports` drafts.** Read today's `daily-reports` run log.
   Then, SELECT only, the reports that are pending approval (draft ready, not
   approved, not sent, not withdrawn: `isPendingApproval` in
   `src/reports/report-row.ts`). Write one exact ask per draft: "approve on
   `/s/<slug>`; it sends with tomorrow's run", plus any preflight warning it
   carries. If the run has not finished yet, say "drafts pending" and give
   the run's state.
4. **PRs merged since `<since>`**, as one line each: number, title, author.
   This is the "what got done" list, so keep it short.
5. **Open PRs that are red or held.** Read every open PR through REST
   (`pulls?state=open`). List each one that has a failing check on its head,
   is a draft, or is a release PR (`chore(release): version packages`, which
   is always the operator's), with its age. A green, unmerged Renovate PR is
   a rule working: name the rule rather than listing it.
6. **The `## Evening` section.** Append it to today's morning report, in this
   order: the headline; the asks, numbered and ordered by date (each one
   exact: what to click or answer, and where); then the evidence (the
   summary line, the nightlies table, merged PRs, open red or held PRs). Tag
   every claim [M] or [I] as the morning report does.
7. **Journal line, PR, land.** Add one line to `docs/workJournal.md` under a
   heading of the form `## <date> — Evening pass (#<pr>)`, giving the
   headline and the summary line. Open the docs-only PR and land it with
   `node scripts/land-prs.mjs <pr>`.
8. **The notification.** The session's last message is the notification. Its
   first line is the single most important thing for tonight, or exactly
   `nothing needs you tonight`. Then at most three more lines, one per other
   ask, most urgent first. Use "nothing needs you tonight" only when step 1
   ran cleanly, no asks were found on a branch or added on `main`, there is
   no `NEW` unprotected branch, no draft is waiting, no nightly is red, and
   no release PR is open. Any other result goes in the headline.

### The evening Routine's stored prompt

The operator pastes this into a new scheduled Routine with these settings:

- **Name:** "Reddoor evening pass".
- **Repository:** `reddoorla/reddoor-maintenance`.
- **Schedule:** `CRON_TZ=America/Los_Angeles 18 17 * * 1-4`. That is 17:18 PT
  all year: the zone is written into the cron, unlike the morning pass's
  bare UTC cron, and the minute is moved off :30 because the scheduler runs
  late on round minutes.
- **Model:** the morning pass's.
- **Notifications:** push on.
- **Session:** a fresh session for each fire.

```text
Evening pass for reddoorla/reddoor-maintenance. It runs Monday to Thursday at 17:18 America/Los_Angeles, each run in a fresh session.

Set up first:
1. This Routine has reddoorla/reddoor-maintenance selected as its repository, so it should already be checked out. If it is not (no checkout of that repo in the working directory), call add_repo (owner reddoorla, repo reddoor-maintenance, access push) and clone it exactly as the result says. If neither is possible, stop and make your final message: "NO REPOSITORY: the evening Routine needs reddoorla/reddoor-maintenance selected as its repository."
2. In the checkout, run:
   - git fetch origin main
   - git status (the checkout must be clean; if it is not, say so and do not discard anything)
   - git checkout --detach origin/main
   - CLAUDE_CODE_REMOTE=true bash .claude/hooks/cloud-session-setup.sh

If any of that fails, stop, and make your final message the exact command and its error.

Then read docs/pm-pass.md, section "The evening pass", and follow it exactly; it is the full instruction set. In short:
- Run node scripts/evening-branches.mjs --repo reddoorla/reddoor-maintenance --main-since <the time today's morning PR merged>. Lift every ask it finds, on a branch or newly on main, into tonight's asks word for word, and list every NEW unprotected branch.
- Read today's nightlies with each FLEET_WRITE_SUMMARY line, today's daily-reports drafts waiting for approval with the exact /s/<slug> ask, PRs merged since the morning pass, and open PRs that are red, draft or release.
- Append "## Evening" to today's docs/morning-reports/MORNING_REPORT_<today>.md, add one docs/workJournal.md line, open one docs-only PR from a new worktree, and land it with node scripts/land-prs.mjs once CI is green.

Read-only otherwise: do not write code, do not edit docs/BACKLOG.md, do not open PRs for other branches, do not comment on other PRs, do not re-run or dispatch any workflow, and never post to Discord. You cannot see live sessions; worker state comes from branches and PRs only. Stop after about 20 minutes and list whatever is still pending as pending.

Your last message is the push notification. Its first line is the single most important thing for tonight, or exactly "nothing needs you tonight" when the pass found nothing (the section defines when that is allowed). Then up to three more lines, one per remaining ask, most urgent first.
```

## What the operator wants to see

- Dated things first. A report due tomorrow outranks everything.
- Exact asks. "Press refresh preview on `/s/29-navy`, then approve" — not
  "review 29 Navy".
- Nothing from "Settled answers" below, ever.
- Evidence tags: **[M]** measured this morning, **[I]** inferred.
- What changed since yesterday, not the whole world again.

## Settled answers — never re-ask

The operator has answered these, some of them more than once. Asking again
costs trust and time. Do not put any of them in the morning report, in
"Operator decisions", or in a question. A new fact that changes one of them
is written up as new evidence, never as the old ask.

- **Report recipients are correct as they are** (2026-09-29). This covers MSOT
  and Revogen sharing `accounting@revogenbiologics.com`, and 29 Navy's send
  going to MatthewB@worthe.com.
- **No Perplexity account** (2026-09-29). `PERPLEXITY_API_KEY` is not missing
  and is not an ask; it matters only if the audit is expanded to use it.

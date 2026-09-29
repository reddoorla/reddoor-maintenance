# The daily PM pass

A scheduled Routine ("Daily PM pass", 04:48 America/Los_Angeles, every day)
starts a fresh cloud session and gives it this file. The session's job is to
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
   report's top of stack with the branch or PR it names.

   **[H] items** are the ones the operator builds by hand. Rank them with
   everything else, but list them in their own "Yours to build [H]" section of
   the morning report, never recommend a worker for one, and never write a
   brief for one. A worker that finds an [H] item already started by the
   operator leaves it alone, as it would another session's branch.

6. **Morning report.** Copy the shape of the most recent file in
   `docs/morning-reports/`: one-line verdict, top of stack for the operator
   (dated, ordered), what landed, nightlies, what went wrong, next for agents.
   Every number in it comes from a query or a log line made that morning.

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

## What the operator wants to see

- Dated things first. A report due tomorrow outranks everything.
- Exact asks. "Set `Report recipients (To)` on 29 Navy, press refresh preview,
  approve" — not "review 29 Navy".
- Evidence tags: **[M]** measured this morning, **[I]** inferred.
- What changed since yesterday, not the whole world again.

# The daily PM pass

A scheduled Routine starts a fresh cloud session every weekday morning and
gives it this file. The session's job is to **prioritize, not build**: it
re-checks `docs/BACKLOG.md` against the live state of the fleet and this repo,
re-ranks it, writes the day's morning report, and lands one docs-only PR. It
does not write code, dispatch fleet workflows, or send anything to a client.
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
   4b. **Discord open asks.** GET only, never post: the bot token is
   `DISCORD_BOT_KEY`, guild `1199077765144662046`, REST at
   `https://discord.com/api/v10`. For each text channel with a message in the
   last 14 days, read its recent messages and list every message that
   mentions the operator (`tucksravin`, user id `214787673846579200`) or asks
   him something by name, where he has neither replied after it in that
   channel nor left **any reaction** on it (the operator's rule since
   2026-09-29: any reaction from him closes the ask). List asks older than two
   days under "Waiting on you (Discord)" in the morning report: channel, who,
   date, and the ask in one line. Do not quote credentials, codes, addresses
   or phone numbers that appear in messages. There are no clients in the
   guild; everyone in it is Reddoor staff.
5. **Backlog diff.** For each P0/P1 item: still true? done? claimed? Move done
   items to the Done section with the PR number. Add what the day's evidence
   surfaced. Re-rank. Update the "Last full re-rank" line.
6. **Morning report.** Copy the shape of the most recent file in
   `docs/morning-reports/`: one-line verdict, top of stack for the operator
   (dated, ordered), what landed, nightlies, what went wrong, next for agents.
   Every number in it comes from a query or a log line made that morning.
7. **Journal entry**, then the PR, then land it.
8. **Finish by posting the one-line verdict and the operator's top three
   items** as the session's last message, so the notification carries them.

## What the operator wants to see

- Dated things first. A report due tomorrow outranks everything.
- Exact asks. "Set `Report recipients (To)` on 29 Navy, press refresh preview,
  approve" — not "review 29 Navy".
- Evidence tags: **[M]** measured this morning, **[I]** inferred.
- What changed since yesterday, not the whole world again.

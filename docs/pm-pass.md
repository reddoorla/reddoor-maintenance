# The daily PM pass

One scheduled Routine ("Reddoor Project Manager") fires twice a day, Monday to
Thursday, the operator's work week: `CRON_TZ=America/Los_Angeles 48 4,12 * * 1-4`,
so 04:48 and 12:48 PT all year (the second fire was at 17:48 until
2026-10-07; the operator moved it after the 2026-10-06 review). Each fire starts a fresh cloud session and gives
it this file. Before 12:00 PT it runs the morning pass; from 12:00 PT it runs
the evening pass, below. Either session then stays open as the operator's
cockpit for the rest of that half-day (set up by the operator 2026-10-05; until
then the morning cron was a bare UTC `48 11 * * 1-4`, and the evening pass was
planned as a second Routine). The session's job is to
**prioritize, not build**: it re-checks `docs/BACKLOG.md` against the live
state of the fleet and this repo, re-ranks it, writes the day's morning
report, and lands one docs-only PR. It does not write code, dispatch fleet
workflows, or send anything to a client.
Worker sessions, started by the operator, pick items off the backlog.

The prompt lives here so it can be changed by PR, like everything else.

## Rules that bind this session

1. Read `CLAUDE.md`, `AUTONOMY.md` and `docs/BACKLOG.md` first. Every rule
   there applies: work in a worktree, never commit from the main checkout,
   prove an instrument before trusting its verdict, and write a journal entry
   (one new file under `docs/journal/`).
2. **Docs only.** The PR may touch `docs/BACKLOG.md`,
   `docs/morning-reports/MORNING_REPORT_<date>.md`, one new file under
   `docs/journal/`, and
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
8. **No "safe to archive" line.** `CLAUDE.md`'s closing line ("Safe to
   archive this session." or "Not yet safe to archive: …") does not apply
   to a Routine session, morning or evening, nor to its cockpit replies for
   the rest of the day (the operator, 2026-10-06). Each fire is a fresh
   session, and the operator does not archive on it.

## The pass, in order

1. **Nightlies since the last report.** `gh api "repos/reddoorla/reddoor-maintenance/actions/runs?per_page=100&created=<yesterday>..<today>"`
   filtered to `event == "schedule"`. For each fleet run, read the job log for
   its `FLEET_WRITE_SUMMARY wrote=N failed=M total=T` line; a green run with
   `failed>0` is not green. Note which tracking issues opened or closed.
2. **The cockpit's Needs-you and Watch state.** From a worktree detached at
   `origin/main`, with `<since>` the `merged_at` of the previous morning
   report's PR (UTC, with its `Z`):

   ```sh
   pnpm tsx scripts/pm-cockpit.mts --since <since>
   ```

   It builds the live cockpit's model from Turso over a SELECT-only
   connection, which must refuse an UPDATE before the first read, and prints
   one `PM_COCKPIT_SUMMARY broken=N watch=N approval=N sites=N new=N` line,
   then "Needs you" (each site, its group, every reason, `/s/<slug>`) and
   "Watch". It exists because the nightlies can all be green while a site
   needs the operator: Data Dynamiq's Search Console `no-property` (2026-10-07)
   reached no morning report. Into the top of stack, each as an exact ask
   ("on `/s/<slug>`, <what to do>"), go every `NEW` site, in either
   section, and every `broken` site with an `(undated)` reason other than
   `… ready`. List the other Watch sites in one line. Beyond the cockpit's
   own feed the script also lists, as broken, a site whose only problem is
   a failed production deploy and a dead letter for a slug no site owns.

   `NEW` comes from the digest snapshot: an item's first-flagged day; for a
   vuln Renovate has not fixed in time, the day its wait failed (that vuln
   sits in Watch, and its `NEW` morning is the morning it first needs the
   operator); and today for a vuln whose auto-fix the snapshot has not yet
   recorded as exhausted. The digest usually records an exhaustion before
   the pass runs, so such a vuln mostly prints `(undated)` under `broken`,
   which the rule above still sends to the top of stack. Dates are compared
   by day, so an item flagged on the `<since>` day can show `NEW` on two
   mornings. Other Watch reasons, approvals, failed deploys and an
   already-exhausted vuln print `(undated)` and are never `NEW`: none has a
   first-seen time. That includes Search Console `no-property`, so read the
   Watch line each day rather than waiting for a `NEW`. Approvals (`… ready`)
   are step 3's. "Just wait" items are already left out, and their count is
   printed as `just_wait_left_out`. An empty digest snapshot, or a failed
   read, stops the script
   with an error; the report then says so, never "nothing needs you".

3. **Reports due in the next 14 days.** Run the pre-send gate the way
   `docs/runbooks/continuity.md` describes and list each due report with its
   blockers, in date order. This is the operator's top-of-stack.
4. **PRs.** Every open PR: author, age, CI state, mergeable state, and whether
   it is a release PR (`chore(release): version packages`, always the
   operator's). A Renovate PR that is green and unmerged is usually a rule
   working (`automerge: false` on `@reddoorla/maintenance`); name the rule
   before calling it stuck.
5. **Issues.** Everything opened, closed or commented since the last report.

   **Discord open asks** (part of step 5). GET only, never post: the bot token is
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

6. **Backlog diff.** For each P0/P1 item: still true? done? claimed? Move done
   items to the Done section with the PR number. Add what the day's evidence
   surfaced. Re-rank. Update the "Last full re-rank" line. Read every line
   added under "Operator decisions" since the last report: workers write their
   stop-condition questions there as well as asking (`CLAUDE.md` → "Worker
   sessions ask a blocking question once, with all its context"), so each new line goes into the morning
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

7. **Morning report.** Copy the shape of the most recent file in
   `docs/morning-reports/`: one-line verdict, top of stack for the operator
   (dated, ordered), what landed, nightlies, what went wrong, next for agents.
   Every number in it comes from a query or a log line made that morning.
   `.github/workflows/pm-pass-watch.yml` emails the operator when a pass has
   not landed by its due time, and it keys on the `## One-line verdict` and
   `## Evening` headings, so renaming either needs a change to
   `scripts/pm-pass-watch.mjs` in the same PR.

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

8. **Journal entry** (a new file under `docs/journal/`), then the PR, then land it.
9. **Finish by posting the one-line verdict and the operator's top three
   items** as the session's last message, so the notification carries them.

## Mondays: the heavier pass

On a Monday the pass does three more things, inside a budget of about 75
minutes instead of 45:

- **Fresh reads, not a diff.** Every open issue, not only those touched since
  the last report, and the live fleet state from Turso (SELECT only): row
  counts by status, cockpit attention and watch (read with
  `scripts/pm-cockpit.mts`, as in step 2, without `--since`), staleness of
  each sweep, and unread form submissions. Rewrite BACKLOG's "Fleet snapshot" from them.
- **Refute the week's claims.** Run the `refute-claims` skill over the
  morning reports from the previous seven days. Every [M] claim in them was
  measured once and then carried forward; this is the one place a wrong one is
  caught. A refuted claim gets a forward pointer in that report (the one edit
  an old document may take, as in the journal rule) and a corrected line in
  today's.
- **Full re-rank.** Re-order P0/P1 from scratch rather than editing the
  previous order, and say so in the header's "Last full re-rank" line.

## The evening pass

The Routine's 12:48 PT fire (Monday to Thursday) runs this pass, in a fresh
cloud session in the operator's afternoon. It fired at 17:48 PT until
2026-10-07. The 2026-10-06 review found that none of 42 operator session starts
or 40 answers since 09-29 fell near that read, that 11:00–15:00 PT is when he
answers most, and that by 19:48Z most of the day's nightlies have finished
(release-health on 3 of 4 measured days).
The operator reads its one notification, then at most the day's `## Evening`
section, then stops: ten to fifteen minutes. The morning pass ranks the day;
the evening pass answers one question, **what needs the operator before
tomorrow morning that the morning report could not see?** Most of the day's
nightlies, the `daily-reports` drafts (which start between about 14:20Z and 18:40Z) and every worker
session's ending all happen after the morning pass has finished.

It exists because of three misses on 2026-10-05. A worker held #1143 and
wrote its question only on its own branch (`claude/wizardly-brown-2ylvcv`),
so `main` asked the operator nothing for 13 hours. Another session left
docs commits on `claude/jolly-keller-9h8tzh` with no PR. And at 12:00Z every
nightly was still pending, so the morning pass could not report any of them.

### Rules that bind the evening pass

0. **"Today" is the America/Los_Angeles date**, `TZ=America/Los_Angeles date +%F`,
   everywhere in this section. The pass fires at 12:48 PT, which is 19:48Z
   (20:48Z in winter), so the UTC date still matches. Until 2026-10-07 it
   fired at 17:48 PT, after the UTC date had moved on, and a late or hand-run
   pass can still cross it. Read the clock
   with `date -u` beside it, as `CLAUDE.md` asks.

1. Everything under "Rules that bind this session" above applies, except
   that the pass is **read-only** apart from one docs-only PR. That PR may
   touch only today's `docs/morning-reports/MORNING_REPORT_<date>.md`, where
   it appends a `## Evening` section, and one new file under `docs/journal/`
   holding one line, not a full entry. It never edits `docs/BACKLOG.md`: it
   lifts what it finds into the report, and the next morning pass re-ranks.
2. **It never acts on what it finds.** It does not open a PR for an
   unprotected branch, comment on a worker's PR, re-run a job or merge
   anything. Each finding becomes an exact ask in the evening section, and
   the next morning pass carries any that are still open. If no morning
   report exists for today (a holiday, or a morning pass that failed), it writes
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

`<since>` is the time today's morning PR merged: the `merged_at`, in UTC with
its `Z`, of the PR that added `MORNING_REPORT_<today>.md`. If no morning PR
merged today, use 12:00Z on today's date. Either way, `<since>` is earlier than
`date -u`. A later `<since>` means the date is wrong, so stop and fix it.

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
     "already item N" and leave it at that.
   - **Other lines under "Operator decisions" only on a branch.** These are
     usually status notes. The script prints them only for branches whose
     last commit is under 36 h old, and names older ones once on a single
     line. Read the listed ones when their branch has a draft PR or is
     unprotected: a question written without `Ask:`, `Pick:` or a closing `?`
     lands here. Lift any you judge to be an ask.
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

2. **Nightlies.** As in the morning pass, step 1: every
   `event == "schedule"` run created in the 24 hours before `date -u`
   (`created=>=<that time>`), with each fleet run's
   `FLEET_WRITE_SUMMARY wrote=N failed=M total=T` line read from its job log,
   and every tracking issue opened or closed since `<since>`. List any run still
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
7. **Journal line, PR, land.** Write
   `docs/journal/<YYYY-MM-DD-HHMM>-evening-pass.md` (the name from `date -u`):
   a heading of the form `## <date> — Evening pass` and one line giving the
   headline and the summary line. Open the docs-only PR and land it with
   `node scripts/land-prs.mjs <pr>`.
8. **The notification.** The session's last message is the notification. Its
   first line is the single most important thing for tonight, or exactly
   `nothing needs you tonight`. Then at most three more lines, one per other
   ask, most urgent first. Use "nothing needs you tonight" only when step 1
   ran cleanly, no asks were found on a branch or added on `main`, there is
   no `NEW` unprotected branch, no draft is waiting, no nightly is red, and
   no release PR is open. Any other result goes in the headline.

### The Routine's stored prompt (both passes)

One Routine, set up by the operator on 2026-10-05:

- **Name:** "Reddoor Project Manager".
- **Repository:** `reddoorla/reddoor-maintenance`.
- **Schedule:** `CRON_TZ=America/Los_Angeles 48 4,12 * * 1-4`. The zone is
  written into the cron, so it does not drift when daylight saving ends on
  11-01, and the minute stays off :00 and :30.
- **Session:** a fresh session for each fire. The newest one is the cockpit.

The text below is the prompt as written for the operator to paste. If the
Routine's copy is edited, this one should be updated in a PR.

```text
Daily PM pass for reddoorla/reddoor-maintenance. This Routine fires twice a day, Monday to Thursday, on its schedule, each run in a fresh session.

Set up first:
1. reddoorla/reddoor-maintenance should already be checked out. If not, call add_repo (owner reddoorla, repo reddoor-maintenance, access push) and clone it as the result says. If neither works, stop with: "NO REPOSITORY: the Routine needs reddoorla/reddoor-maintenance selected as its repository."
2. In the checkout run: git fetch origin main; git status (must be clean; if not, say so and discard nothing); git checkout --detach origin/main; CLAUDE_CODE_REMOTE=true bash .claude/hooks/cloud-session-setup.sh. If any step fails, stop, and make your final message the exact command and its error.

Then read the clock (TZ=America/Los_Angeles date) and pick the pass:
- Before 12:00 PT: the MORNING pass. Read docs/pm-pass.md and follow "The pass, in order" exactly (on Monday, also "Mondays: the heavier pass"). Budget about 45 minutes, or 75 on Monday.
- 12:00 PT or later: the EVENING pass. Read docs/pm-pass.md and follow "The evening pass" exactly, including its rules. It appends to today's morning report rather than writing a new one.

Both passes: facts come from the repo, the APIs and the nightlies, never from memory. Do not write code. Do not dispatch daily-reports or fleet-security. Do not take items claimed by other sessions. Never post to Discord. Land exactly one docs-only PR with node scripts/land-prs.mjs once CI is green. List any nightly still pending at the time budget as pending.

End with one push notification and a last message that is the one-line verdict, followed by the operator's top three dated items.

After that, this session is the operator's cockpit and project manager for the rest of the day: answer questions, record decisions in docs/BACKLOG.md, and queue worker sessions with briefs. Do not do work that a worker should be assigned.
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
- **"Just wait" is not an ask** (2026-10-05, verbatim: "anything where the
  action is 'just wait' shouldn't be a watch item until it gets to a point where
  it actually requires my intervention"). A signal that a scheduled job is
  already fixing (Renovate's nightly dispatch, the Monday lock-file window, a
  sweep that has not run yet, a draft waiting for the next run) is not listed
  in the morning report, "Operator decisions" or a question until its own
  threshold says the wait has failed. The code enforces this for vulns today
  (`src/alerts/waiting.ts`, #1190): a vuln Renovate is still fixing shows only
  on the site's `/s/<slug>` page, and the cockpit's Needs-you feed and the
  digest list it once its wait has failed. For every other signal apply the
  rule by hand: if a scheduled job will clear it before its own schedule says
  it should have, it is not an ask. A deadline the operator owns (a report due
  date, an expiring credential) is never a waiting item.

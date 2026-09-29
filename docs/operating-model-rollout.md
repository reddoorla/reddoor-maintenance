# Rolling out the new operating model — 2026-09-30 → 2026-10-31

The model is in `docs/operating-model-review-2026-09-29.md`, with the operator's
answers in its §7. In one paragraph: a fresh PM session every morning is the
operator's single inbox; the operator spends 15–20 minutes on it and starts
workers from backlog items; workers never ask mid-flight, they write the
question into the backlog; asks from the team arrive as Discord mentions and are
closed by any reaction from the operator; the laptop becomes optional.

This file is the plan to get there. Each step names who does it and how we know
it worked. Tick a step by moving it to "Done" at the bottom with the date and
the evidence, in the PR or session that did it.

## Before the trip (2026-09-29 / 09-30)

| #   | Who      | Step                                                                                                                                                          | Proof it worked                                                                          |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| B1  | Agent    | Land the open PR queue (#916, #918, #920 and the combined changesets upgrade replacing #897/#901) into the pending release, so one release carries everything | `pulls?state=open` shows only #952 (and docs PRs); #952's body lists every changeset     |
| B2  | Operator | Merge the changesets-upgrade PR (RED: it rewires `release.yml`), then merge #952                                                                              | npm `latest` = the new version; a `v*` tag and GitHub Release exist for it               |
| B3  | Agent    | Bump `roalson-interests` to the new `@reddoorla/maintenance` (it pins `^0.96.0`, which on 0.x never reaches 0.101) and land it                                | roalson CI green on the bump; its a11y gate now scrolls (roalson-interests#100 closable) |
| B4  | Operator | Upload `markup-review.zip` and `new-site.zip` at claude.ai → Settings → Capabilities → Skills                                                                 | a new cloud session lists both skills                                                    |
| B5  | Operator | Add `GA_SUBJECT`, `GA_SA_KEY_B64`, `PERPLEXITY_API_KEY`, `MARKUP_API_KEY` to the cloud environment (walkthrough in the 09-29 session)                         | a new session's setup hook is silent about the GA key; `markup-review`'s `list` answers  |
| B6  | Operator | Say whether the Daily PM pass is pinned to Opus (recommended)                                                                                                 | the Routine's model field                                                                |
| B7  | Operator | Post the team note (below) in Discord                                                                                                                         | it is posted                                                                             |
| B8  | Operator | Gmail: add the filters below                                                                                                                                  | next week's vendor mail skips the inbox                                                  |
| B9  | Operator | On the laptop, `git -C ~/Documents/GitHub/reddoor-maintenance pull` so hooks and settings stop carrying the Airtable entries                                  | `session-start-checks` stops warning                                                     |
| B10 | Agent    | Watch the first Daily PM pass (09-30 04:48 PT) and fix whatever it trips on                                                                                   | its notification arrives with a verdict and three items; its docs PR lands               |

## Week 1 (10-01 → 10-07): make the morning loop work

| #   | Who   | Step                                                                                                                                                                                                                                                                                                                                       | Proof it worked                                                               |
| --- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| W1  | Agent | **P1-20**: the digest sends only when its pending set changes (or weekly), and names the exact ask with its age                                                                                                                                                                                                                            | two days with an unchanged set send nothing; a repeated item reads "(3 days)" |
| W2  | Agent | Worker rules into `CLAUDE.md`: (a) workers never ask mid-flight, they add an "Operator decisions" line and stop; (b) before starting, `git ls-remote --heads origin 'refs/heads/claude/*' 'refs/heads/fix/*'` and look at anything under a day old; (c) after two dirty review rounds a PR goes to "Operator decisions", not a third round | the next three worker sessions follow them without being told                 |
| W3  | Agent | A worker brief template (`docs/worker-brief.md`): the item, "start here", the done-when, the mutations the worker will run, and the stop conditions. The PM pass pastes one per item it recommends starting                                                                                                                                | the operator starts a worker by pasting a brief from the morning report       |
| W4  | Agent | **[H]** tag in the backlog for work the operator wants to do by hand; the PM pass ranks it and never recommends a worker for it                                                                                                                                                                                                            | at least one [H] item exists and the morning report lists it separately       |
| W5  | Agent | A clean-send streak: each [TEST] report send gets one line in the backlog's Done section (site, date, clean or what was wrong), and the PM pass reports the current streak                                                                                                                                                                 | the morning report shows "clean [TEST] sends in a row: N"                     |
| W6  | Agent | **P1-21**: retire `docs/autonomy-journal.md`, fix AUTONOMY.md's settings claim                                                                                                                                                                                                                                                             | merged                                                                        |

## Weeks 2–4 (10-08 → 10-31): tune, then decide

- **Mondays** the PM pass also does the heavier re-rank: fresh reads of the
  issue list and the fleet state, and a `refute-claims` run over the week's
  morning reports. This is a paragraph in `pm-pass.md`, not a second Routine.
- **10-14, two-week check** (the PM pass writes it into that morning's report):
  - minutes the operator spent per morning (ask the operator);
  - Discord asks older than two days, per day;
  - days a zero-blocker report waited for its click;
  - PRs that needed a third review round;
  - duplicate-work incidents.
    Keep what moved, cut what did not.
- **Auto-approve for zero-blocker Maintenance reports** comes back to the
  operator only when the clean-send streak (W5) reaches the number the operator names.
  Until then the click stays.
- **10-19**: Reddoor's Webflow licence lapses. The two remaining Webflow sites
  are converted or the renewal is decided before then (BACKLOG operator item 7).

## The team note (B7), in the operator's register

> hey all, i'm on the east coast through october. if you need something from me,
> @ me with the ask (a numbered list if it's more than one thing, and paste the
> source if it came from a client). i'll react to it when it's handled, so no
> reaction means i haven't gotten to it yet. there's a read-only bot that checks
> the channels each morning for anything i've missed.

## Gmail filters (B8)

Each: Gmail → Settings → Filters → Create a new filter, "From" as given, then
"Skip the Inbox" and "Apply the label" `Vendor`. Search Console stays in the
inbox; it carried a real robots.txt block this month.

- `from:(adobe.com OR squarespace.com OR zoom.us)`
- `from:(dropbox.com) subject:(weekly OR activity)`
- `from:(harvestapp.com) subject:("no hours" OR reminder)`
- `from:(forms@reddoorla.com) cc:(tucker@reddoorla.com)`: form relays
  addressed to a client, where the operator is only cc'd. Check the first
  week's matches: a lead addressed to the operator directly must not match.

## Done

- 2026-09-29 — **B2**: the operator merged #952 (0.101.0 on npm 17:01Z, annotated `v0.101.0`, Release created) and then #901 (changesets/action v2 + CLI v3; its first run was a clean no-op). B1 is therefore split: 0.101.0 shipped without #916/#918/#920, which go to 0.102.0.
- 2026-09-29 — **B3**: roalson-interests#196 (`8ecd279`) is on `^0.101.0`; its a11y gate passed with 0 violations across 5 routes. roalson-interests#100 closed.
- 2026-09-29 — **B4 prepared**: `markup-review` made path-independent (claude-skills#11); both zips handed to the operator.
- 2026-09-29 — **W6**: done by another session in #971.
- 2026-09-29 — **W2, W3, W4** and the Monday paragraph (#973): worker rules in `CLAUDE.md`, `docs/worker-brief.md` with a checked P1-12 example, the [H] tag in BACKLOG and `pm-pass.md`, the Monday pass. W2's proof ("the next three worker sessions follow them") and W4's (an [H] item exists) are still to come.
- 2026-09-29 — **W5** (#974): the record is a table in BACKLOG ("Clean-send streak"), not a Turso table, because the operator's verdict is its only input and no check can see the email; `pm-pass.md` step 6 reports "clean [TEST] sends in a row: N" and asks for each `awaiting` verdict. No code on `main` produces a "[TEST]" subject. The table starts with the 2026-09-28 29 Navy send, awaiting its verdict.
- 2026-09-29 — **W1 / P1-20 not done**: #975 is parked after two dirty review rounds and waits on BACKLOG "Operator decisions" item 19, the first use of the W2 rule.

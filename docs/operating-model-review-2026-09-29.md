# Operating-model review — 2026-09-29

**Status: recommendations for the operator, written the day before a month on the
East Coast.** Built from three read-only surveys made this afternoon: the repo's
operating setup and every September journal entry (60 entries), the operator's
mailbox for the last 30 days (121 threads), and the Reddoor Discord for the last 21
days (~1,000 messages, 20 channels). Where a number is quoted it was measured today
**[M]**; where it is a reading of the evidence it is marked **[I]**. This is a
second pass over the ground `docs/superpowers/specs/2026-09-14-operating-model-recommendations.md`
covered on 09-14; §5 says which of that document's recommendations were adopted.

The one-line version: **the system builds fast and the operator is the bottleneck,
because every "needs you" reaches him through a different channel, most of them
either silent or nagging.** The fixes below are mostly about that, not about the
agents.

## 1. How the work is structured today

- **The repo is the memory, and it is good.** `CLAUDE.md`, `AUTONOMY.md`,
  `docs/BACKLOG.md`, the journal and the runbooks carry enough that a fresh cloud
  session could run sixteen PRs through the landing gate last night with none of the
  laptop's memory, skills or plugins [M].
- **The laptop is still the only place some things exist [M].** The seven skills
  (`reddoorla/claude-skills`: `new-site`, `evening-review`, `markup-review`,
  `matching-a-page`, `figma-slices`, `rfp-analyze`, `svelte4-to-5-upgrade`), the
  auto-memory index, the plugins, `credentials.env` and the repo `.env`. None reach a
  cloud session. The cloud environment is also missing `GA_SUBJECT`, `GA_SA_KEY_B64`
  and `PERPLEXITY_API_KEY`, so a report drafted from the cloud silently has no
  analytics section.
- **Four humans, no clients, no tracking.** The Discord is Tucker, Tim, Nicole and
  Erik [M: `approximate_member_count: 5` including the reader bot]. Every client ask
  arrives as a relay: Erik's voice-to-text after a call, a pasted email, Tim's
  screenshot brief. Trello was cancelled in June; nothing mirrors an ask anywhere.
  Tim, 09-17: "Kind of like using 'Messages' to manage our projects."
- **The "needs you" signals live in five places, and each has a defect [M]:**
  | Channel                   | Defect                                                                                                                                                                                                                                                   |
  | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Daily digest email        | Nags. From 09-18 to 09-28 every digest repeated "29 Navy Maintenance draft can't be approved — health-gate (+4 more)". 8 of 25 were trashed, one unread. The subject said "1 report ready for your yes" for eleven days.                                 |
  | GitHub tracking issues    | Dark. `continuity.md` calls them "the durable signal", but zero GitHub mail has reached the mailbox in 180 days, so an issue is seen only when someone opens GitHub.                                                                                     |
  | The cockpit               | Pull-only. Nothing tells you to look.                                                                                                                                                                                                                    |
  | Discord `@tucksravin`     | Scrollback. Six explicit chases in three weeks ("bump on this, renews in 4 days", "any word?", "how about now?"), and the 10-19 Webflow renewal, VLF's GitHub/Prismic access, the apostrophe fix and the Worthe email exist only as unanswered mentions. |
  | Email relays via Erik/Tim | The drop pattern. Erik's 09-15 Revogen punch list was forwarded with no note and has no email reply in 14 days; the 09-23 Revogen Figma approval went to Trash with the vendor mail.                                                                     |
- **Delivery is fast; approval is slow.** When the ball is in Tucker's court, email
  replies come in 5 min to 4h43m [M]. But the 29 Navy report has had 0 blockers since
  about 09-18 and is unsent because one cell (`Report recipients (To)`) is empty, and
  two of Tucker's own product questions in `#rd-clients-by-design` (the audit CTA,
  the multi-agent build) have waited two weeks for Tim [M].
- **What Tucker said about it himself** (Discord, 09-28): "the claude workflow is
  super efficient and effective, but the fact that it's both always working and can
  pretty much always take my input … is weird for my schedule, and i do touch actual
  code less which is a bummer."
- **September's friction, from the journal [M, my tallies over 60 entries]:** review
  rework ~20 entries (14 of last night's 16 PRs needed a fold-in; #918/#920 went four
  dirty rounds and were abandoned), tooling and sandbox false results ~18, collisions
  between concurrent sessions ~15 (#932 duplicated #933 after "checking open PRs but
  not fresh branches"), context and state loss ~11, classifier refusals ~8, landing
  races ~7. The first is partly the process working; the third and fourth are pure
  cost.

## 2. Recommendations, ranked by what they unblock

### R1. One morning inbox, sent on change, with the exact ask — the daily PM pass

Done today, unproven until tomorrow. Routine "Daily PM pass" starts a fresh cloud
session at **04:48 PT every day** (7:48 ET), reads `docs/pm-pass.md`, re-ranks the
backlog against the nightlies, the PRs and the issues, writes the morning report,
lands one docs PR, and sends a push and an email whose last lines are the verdict and
the top three dated items. It replaces the "is anything on fire" scan and the GitHub
tracking issues nobody receives.

Two things it should grow into, both one edit to `pm-pass.md`:

- **Read Discord.** `DISCORD_BOT_KEY` is in the cloud environment and `discord.com` is
  reachable from it [M: today's survey ran there]. A pass that lists every
  `@tucksravin` mention in the active channels with no reply from Tucker after two
  days is exactly the table §1 quotes, and it was produced in one agent run. The
  close signal already exists: a ✅ reaction from Tucker (the bot can read reactions).
- **Pin it to Opus.** Fresh Routine sessions ran on Sonnet today [M: probe session
  `last_served_model: claude-sonnet-5-5`]. The 09-14 A/B (R8) found Sonnet confirmed
  a planted false claim where Opus did not; the PM pass is judgment, not typing. This
  needs your say-so; I did not change it.

Not possible from here: Gmail. Routines created from a session cannot carry
connectors on this account, so email stays yours, or you create the Routine from the
claude.ai Routines UI with Gmail attached.

### R2. Make the digest stop nagging and start driving

`src/reports/digest.ts` already skips an empty day and de-duplicates a same-day resend
[M: `:608-660`], but a day whose pending set is unchanged still sends. Two agent-doable
changes, added to the backlog as **P1-20**:

- Send only when the set of items changed, or once a week as a heartbeat; carry the
  age ("11 days") on each repeated item.
- Carry the exact ask, not the category: "29 Navy — set `Report recipients (To)` on
  `/s/29-navy`, then approve", linked to the cell, instead of "can't be approved —
  health-gate (+4 more)".

### R3. Two fixed touchpoints a day, nothing in between

This is the answer to "always working, can always take my input". The agents should
never need you mid-flight.

- **Morning, 15–20 min:** read the PM pass. Make the decisions under "Operator
  decisions" (approve reports, answer asks). Start 1–3 worker sessions by pasting a
  backlog item's "start here". That is the whole interaction.
- **Workers never ask.** A worker that hits an AUTONOMY stop condition writes the
  question into `docs/BACKLOG.md` under "Operator decisions" and ends its turn; the
  next morning's pass surfaces it. This is already how last night ran; make it the
  rule in `pm-pass.md` and in the worker brief (R7).
- **Evening: optional.** The `evening-review` skill is laptop-only. Either port it into
  the repo (`.claude/skills/`, which cloud sessions load) or drop it: the morning pass
  now covers what it did.
- **Keep the code you want to write.** Tag backlog items **[H]** for "operator builds
  this", and the PM pass will rank them but never dispatch them. From Discord, the
  work you reach for is Reddoor's own site and design-adjacent front-end; there is no
  reason an agent has to take it.

### R4. Give the team a way to hand you things that does not die in scrollback

Not a Claude change; a convention, and a small one because Tim already does it:

- An ask to Tucker is an `@tucksravin` mention with a numbered list (Tim's briefs) or
  a pasted source (Erik's emails), never "see the thread".
- Tucker closes with ✅ on the message. Open = mentioned, not ✅, older than two days.
- The PM pass (R1) lists the open ones each morning. Nothing else to adopt, no tool,
  no Trello.

While you are away, this is also how Erik and Tim find out what you have not seen.

### R5. Decide the approval policy for zero-blocker Maintenance reports

The human approval gate is by design and should stay for anything with a blocker or
an override. But a Maintenance report with **0 blockers for N days** is a case where
the gate only adds latency: 29 Navy has been in that state for eleven days. Options,
yours to pick:

1. Keep it as is; R2's exact ask makes the click cheap.
2. Auto-approve after 3 days at 0 blockers **unless** the site is marked hold, with
   the digest saying "will send tomorrow unless you hold it". Emails clients without
   your click, so it is a RED-tier policy change, agent-implementable once decided.
3. Auto-approve only for sites you list.

Testing reports (Sonder's first is due 09-30) stay human either way.

### R6. Make the laptop optional for a month

- **Add to the cloud environment:** `GA_SUBJECT`, `GA_SA_KEY_B64`,
  `PERPLEXITY_API_KEY` (BACKLOG operator item 10). Until then any cloud-drafted
  report lacks analytics and nothing says so.
- **Move the skills into the repo.** `.claude/skills/<name>/SKILL.md` is loaded by
  cloud sessions; `~/.claude/skills` is not. `new-site`, `markup-review` and
  `evening-review` are the ones a cloud session would use. Agent-doable once you say
  which; the private repo stays the source if you prefer a sync.
- **Pull the main checkout before you leave.** Its `.claude/settings.json` still
  carries the Airtable entries [M]; hooks load from there, so a laptop session runs
  the old config. `session-start-checks` warns about exactly this.

### R7. Cut the two pure-cost frictions: collisions and rework rounds

- **Collisions (~15 entries).** The rule is "check open PRs and fresh branches"; the
  #932/#933 duplicate came from doing the first and not the second. Add the command
  to CLAUDE.md's rule so it is mechanical:
  `git ls-remote --heads origin 'refs/heads/claude/*' 'refs/heads/fix/*'` and look at
  anything younger than a day. One PM session per day (R1) removes the PM-vs-PM case
  by itself.
- **Rework rounds (~20 entries).** Reviews finding real bugs is the process working
  (two of last night's finds would have broken production). The cost is rounds three
  and four. Two rules: the worker brief carries a "mutations I will run" list before
  code is written (the 09-14 R14 template, never adopted), and after two dirty review
  rounds the PR goes to "Operator decisions" instead of a third round. #918/#920
  would have reached you two weeks earlier.

### R8. Small, cheap, today

- **Gmail filters** for the ~30 threads a month you already hand-trash: Adobe,
  Squarespace, Zoom, Dropbox weekly, Harvest "no hours", Search Console monthly. Real
  signals went to Trash with them this month (Revogen's Figma approval, Tim's
  Markup.io invite, the robots.txt block on reddoorla.com, a Workspace security
  notice).
- **Stop cc'ing yourself on `forms@` relays addressed to clients** (ERP's six this
  month are vendor spam). The digest already counts submissions.
- **Turn on GitHub notification email for `reddoorla`**, or accept that the PM pass is
  the only reader of tracking issues. Right now both are off.
- **Retire `docs/autonomy-journal.md`** (no row since 09-09 while AUTONOMY.md:119
  still points there) and fix AUTONOMY.md's "settings.json is local, gitignored"
  (false since #788). Added as **P1-21**, agent-doable.

## 3. What to do about the four client items that look stalled

From email and Discord together, as of this afternoon [M]. They may all be handled
by voice; these are the ones with no written close.

1. **VLF launch.** Blocked on the hosting/maintenance contract language Erik asked
   for on 09-17 (no reply in channel) and on your 09-23 ask to Brooke for a Prismic
   editor email and a GitHub user (no reply, 6 days). Erik's 09-25 question "do we
   need their password?" for `VLF2026` is unanswered. One message to Erik closes two
   of the three.
2. **Revogen.** Erik's 09-15 list (RevoGro brochure back online, AmnioArmor off the
   main site and the distributor hub) has "did 2, blocked on the other two" and then
   nothing; Erik "figured it out" in Prismic himself. Confirm the brochure is live.
3. **Webflow, hard date 10-19.** Two sites still to convert, Domaru must stay up to
   11-01 on Tim's word while Reddoor's Webflow cancels 10-19. Worth a line in the
   backlog with the date, which it now has.
4. **Rick Garcia (Aston Prestige Windows and Doors)**, inbound lead 09-16, forwarded
   to Tim and Erik, no visible reply in 13 days.

## 4. The rhythm, if all of this is adopted

| When               | Who             | What                                                                                                   |
| ------------------ | --------------- | ------------------------------------------------------------------------------------------------------ |
| 04:48 PT daily     | PM pass (fresh) | Nightlies, PRs, issues, Discord open asks → backlog re-rank, morning report, one docs PR, push + email |
| Morning, 15–20 min | Tucker          | Decisions; approve reports; start 1–3 workers from backlog items; ✅ what is done                      |
| Day                | Workers (fresh) | One backlog item each; PR reviewed and landed; questions go to the backlog, never to you               |
| Nightly            | The 13 crons    | As today; alarms now fire on cancel too                                                                |
| Monday             | Weekly pass     | Heavier re-rank with fresh surveys; the saved `refute-claims` workflow over the week's claims          |
| Ad hoc             | Tucker          | The **[H]** items, by hand, because you want to                                                        |

## 5. The 09-14 recommendations, fifteen days on

Adopted: R1 (claude-mem off), R2 (destructive-git deny), R3a (orphan report), R4
(refuter workflow, not re-run since), R6 (stop runbook), R7/R8 (experiments run),
R11a (no local browser), plus #857/#858 and the `.session-logs/` convention. Refused
or deferred by the operator: R5, R11c (second machine; the cloud took its place
09-28). Never adopted: R14 worker-brief template, R15 path-scoped rules, R16
capability index, R17 claim file. R14 is the one this review asks for again (R7
above). The others can stay dead.

## 6. Honest accounting

- The PM pass is an untested instrument. Its probe session started, loaded the repo's
  context and ended cleanly [M], but its result table could not be read from this
  session, and a second run was refused by the permission classifier. Tomorrow's
  07:48 ET notification is the first real proof; if it does not arrive, the Routine
  is the suspect.
- The Discord survey sampled 20 of 109 channels and could not enumerate members or
  webhooks (403). "No clients in the Discord" rests on the member count and the
  author set, which is strong but not exhaustive.
- The email survey covers one mailbox. Anything handled on a call or in Figma
  comments is invisible to it; the four items in §3 are "no written close", not "not
  done".
- None of §2 makes the agents better. Last night's sixteen PRs were fine. The
  bottleneck they exposed is the channel between the system and you, and every
  recommendation above is about that.

# Challenge — the completeness critic

Written 2026-09-12 against the eight lenses' candidate set. Everything below was
re-derived on this machine today; where I corrected one of the source documents
or one of the candidates, the correction is stated with the command that
produced it.

## What the candidate set covers, and what shape that leaves

Twenty-two candidates arrived from eight lenses. Deduplicated by subject they
are really **nine** things: secret-scanning alerts (four candidates), the a11y
fixture gate (two), Renovate outcome instruments (two), the form-e2e / lead
path (three), Phase 6 and the rollback window, backups and credentials, the
`gh issue list` truncation, fleet config drift, and one on session shape.

Every one of those nine is a property of **the machine**. Not one candidate is
about the **business the machine exists to serve**: what the clients are owed,
whether it has been delivered, who else works here, what anyone pays, or what
happens if the one operator is unavailable. Four separate candidates re-derive
the same five secret-scanning alerts; zero ask whether the maintenance reports
those clients contract for have ever been produced.

They have not. That is candidate 1.

The second structural gap: the candidate set is almost entirely _additive_.
Twenty-two proposals, nineteen of which add a check, a field, a test or a
report to a system already carrying 58 open issues that is closing five a week
and opening thirty-five. Nobody proposed a subtraction, and nobody costed the
additions against the channel that has to deliver their verdicts. That is
candidate 4.

---

## Candidate 1 — The quarterly maintenance report has never once been produced, and eleven come due starting 2026-10-05

```yaml
title: The quarterly maintenance report has never once been produced, and eleven come due starting 2026-10-05
track: system
effort: day
impact: highest in this list — it is the only candidate about the thing clients pay for
```

**Problem.** The whole orchestrator exists to produce a periodic maintenance
report for contract sites. In the entire recorded life of the `Reports` table
that report has been produced for **one site**. Of 17 rows, 15 are
`Announcement` — the fleet-wide blast of 2026-07-06 and the five Beachfront
test sends of 2026-08-24 — and **2 are `Maintenance`, both Sonder** (sent
2026-07-31 and 2026-09-01). Sonder is the only `Monthly` site. The eleven
`Quarterly` sites have never had a Maintenance report drafted, rendered,
approved or sent. On 2026-10-05 five of them come due on the same day, on a
path that has never run for any of them — and `src/db/freeze.ts` plus #646
propose deleting the Airtable layer that path is written against in between.

**Evidence.** Airtable `Reports`, 17 rows, every one `Delivery status =
delivered`: `Report type` is `Announcement` ×15 and `Maintenance` ×2, both
`Sonder — Maintenance — 2026-07-30` and `2026-08-31`. `Next maintenance at`
across the 13 `maintained` rows: Sonder 2026-10-01 (Monthly); Data Dynamiq,
Espada, Vineyard Custom Homes, Revogen and LA Homelessness Initiative all
**2026-10-05**; ERP Industrials and Reddoor 2026-10-25; 1836dig 2026-10-31;
Beachfront Dentistry 2026-11-08; MSOT and CalTex 2026-11-21. LA Homelessness
Youth is `freq=None` — deliberate, it is portfolio copy. Coupling:
`grep -rln airtable src/reports/` returns **22 files**, and
`src/reports/due.ts:1` types the due calculation itself on
`./airtable/websites.js`, so the scheduler, the drafter, the queue, the
preflight, the send orchestrator, the digest and the Resend webhook are all
Airtable-shaped. Two of `daily-reports.yml`'s own comments already record this
exact class of failure: #469, where every CI-drafted report shipped with a
blank ANALYTICS section because the credentials were only wired into that one
workflow, and the `--preview --enrich` note explaining that a plain `--preview`
"does no IO whatsoever, so the verify step could never pass however good the
secrets were."

**This corrects an existing candidate.** The "Declare the rollback window
closed" candidate states in its risk section that "the report send path will
not self-exercise again until roughly late November." Measured, it is
**2026-10-01 and 2026-10-05** — nineteen and twenty-three days out. The
late-November date is MSOT's and CalTex's, the last two of the batch, not the
first. The correction cuts the available runway in half and it lands inside the
window in which Phase 6 would execute.

**Proposal.** Before Phase 6 touches anything, and before the meta week ends:
draft one Quarterly Maintenance report for one site through the real path,
end to end, and look at it. `report <slug> --preview --enrich` is the
credential proof and it already exists; it is not the deliverable proof,
because previewOnly never queues a draft, never writes a Reports row and never
exercises approve → send → webhook. Do the full path once on a site you can
afford to send to — Reddoor's own row is `maintained`, quarterly, has explicit
`Report recipients (To)`, and is the only client in the fleet you cannot
embarrass. That is the known-good control the house rule demands, and every
piece of downstream work then has a proven baseline: the Oct 5 batch, the #646
deletion, and the `resend-webhook` port all become changes against something
observed to work rather than against something assumed to.
Then decide the ordering question explicitly: either Phase 6 lands _after_
2026-10-05 so the quarterly path fires once on the store it was written for,
or Phase 6 lands first and the quarterly path's first-ever execution is also
its first execution on a rewritten data layer. Those are the only two options
and today neither has been chosen.

**Risk.** Doing it means sending one real report to one real recipient — pick
the recipient deliberately. Not doing it means the first evidence that the
maintenance-report path works for a quarterly site arrives on 2026-10-05, for
five sites at once, roughly three weeks after the meta week, with the operator
back in normal delivery load and the Airtable layer possibly gone.

---

## Candidate 2 — Write the one page that lets the fleet survive a week without Tucker

```yaml
title: Write the one page that lets the fleet survive a week without Tucker
track: workflow
effort: half-day
impact: high — low probability, and the only failure in this list with no partial recovery
```

**Problem.** Nothing in the candidate set asks what happens if the operator is
unavailable. The answer, measured, is that the automation keeps running and
nothing it produces reaches anyone, no client-facing output can be released,
and the configuration that generates 2,622 commits per 45 days exists on one
laptop in no version control and no backup.

**Evidence.** Client-facing releases are gated on one person and one
credential: `netlify/functions/approve-report.mts:81` is
`requireOperator(req, …)` behind ambient Basic auth, approval requires a typed
reason that `approveReport` "refuses outright (no bypass)", and
`src/reports/send/orchestrate.ts:159` throws rather than send even if
`Approved to send` was set directly in Airtable. Alarms reach exactly two
places, both of which require him to go looking: auto-filed GitHub issues, and
a digest email to `operatorEmail()` (`src/util/operator.ts:26`), which falls
back to a shared address only because #540 fixed an incident where the digest
went out from a laptop with `OPERATOR_EMAIL` unset. There are **six runbooks**
in `docs/runbooks/` — GA/Search role cutover, PAT retirement, Prismic model
delivery, Renovate app identity, Require-Turnstile rollout, Turnstile widgets —
and **not one** covers restore, incident response, credential recovery, or
"someone other than Tucker needs to do something." The Turso restore procedure,
rehearsed three times, lives inside
`docs/superpowers/plans/2026-08-17-airtable-to-turso-migration.md`. And the
agent layer itself is unversioned: `.gitignore:14` is `.claude/` and
`git ls-files .claude` returns **0 files** in the central repo, so every hook,
skill, agent definition and settings file that makes this operating model work
is on one disk, notwithstanding that #699 already settled the identical
argument in favour of tracking `CLAUDE.md`.

**The thing that makes this actionable rather than theoretical:** he is not
alone. The Discord guild has at least four participants — `tucksravin`,
`nicole_35266`, `timholmes_62898`, `eriksvendsen_89989` — and there are
channels (`#new-business`, `#schedule`, `#msot`, `#rd-marketing`) in which
Tucker does not appear at all. So "who would do it" has a real answer; what is
missing is anything they could act on.

**Proposal.** One page in `docs/runbooks/continuity.md`, written in an hour,
answering six questions: (1) what runs unattended and what its failure looks
like; (2) what is safe to ignore for a week (answer: everything — no report can
go out without an approval, which is a feature, say so explicitly); (3) what is
not (a lead-path break, which today nothing would notice — see the #645
candidate); (4) where the credentials are and who can reach them; (5) how to
reach the clients, per channel; (6) the Turso restore steps, promoted out of
the migration plan, including the step the rehearsals never needed —
`db restore` refuses a non-empty target, so a real recovery lands on a new
database and `TURSO_DATABASE_URL` must be repointed across Actions secrets and
the central Netlify site. Then version `.claude/` — or write down, once, why
not; the #699 reasoning is sitting there either way.

**Risk.** Writing a continuity page nobody has tested is the same untested
assertion the house rule names, so prove the one step that can be proved
cheaply: hand the restore section to a fresh session with no context and see
whether it can follow it. Not doing it costs nothing until the week it costs
everything, and there is no partial version of losing the laptop.

---

## Candidate 3 — Re-measure "159 unpushed commits" before pushing anything, because most of it is archive tags and stashes

```yaml
title: Re-measure "159 unpushed commits" before pushing anything, because most of it is archive tags and stashes
track: workflow
effort: hours
impact: medium — small residue, but the finding as written invites a wrong action
```

**Problem.** `08-second-pass.md` §2 reports "159 commits exist on no remote"
across 13 repos, frames it as data-loss risk ("one disk failure from gone"),
and offers: _"Say the word and I will push the ones you want pushed."_ The
number is real; the interpretation is mostly wrong, and acting on the offer
would push dead branches back to GitHub. This is the house rule's own failure
shape — a FAIL reported without a known-good control — reproduced inside the
evidence package assembled to inform the meta week.

**Evidence.** I re-ran the same command across all 41 checkouts today.
`git rev-list --all --not --remotes --count` now totals **96** in repos that
have a remote (down from 159 — the doc's two headline items,
`welcome-to-the-flower-court`'s 33 and `Broken`'s 19, are both **0** as of
13:20 today), of which 5 sit in the two archived repos that cannot take a push,
leaving **91 pushable-but-unpushed**. Decomposing by owning ref:

- `la-homelessness-initiative` — all **19** are reachable only from
  `refs/tags/archive/generalized-legacy-svelte4`, a deliberate local archive
  tag of the pre-upgrade history. Per-branch check: not one `refs/heads` in
  that repo holds a single unpushed commit. `origin/main..main` is **0**.
- `refs/stash` is counted as unpushed commits in `reddoor-maintenance`,
  `revogen`, `gallerysonder` and `vineyard-custom-homes`. A stash is not
  pushable by construction.
- `data-dynamiq`'s 9 sit on `feat/forms-dashboard-ingest`,
  `feat/turnstile-widget`, `fix/slider-title-clobber`,
  `perf/bestpractices-cookies` — shipped-feature names, i.e. the orphaned
  originals a squash merge leaves permanently unreachable from any remote ref.
  `origin/main..main` is 0 here too, as it is for `revogen` and
  `vineyard-custom-homes`.
- Genuinely live in-flight work is small: `beachfront-dentistry`
  `fix/p751-unanchored-score` (2, checked out), `vida-legacy-foundation`
  `fix/nicole-review-2026-09-09` (1, today), `reddoor-website`'s three
  design/feat branches (4).
- **The one unambiguous item: `rfp-analyze` has 24 commits on `main` and no
  `origin` at all.** That history exists on this disk and nowhere else, and no
  amount of pushing fixes it because there is nothing to push to.

Fleet memory already records this exact class — _"A stale worktree poisons
archaeology: a MERGED PR was called 'unpushed'."_

**Proposal.** Thirty minutes. Replace the query with
`git log --branches --not --remotes` (branches only — excludes tags, excludes
stash) cross-checked against `gh pr list --state merged`, and prove it in both
directions before believing it: it must return **0** for
`la-homelessness-initiative` (where the residue is an archive tag, the
known-good PASS control) and must name `beachfront-dentistry`'s
`fix/p751-unanchored-score` (live work, the FAIL control). Then push the three
or four live branches, delete the orphaned squash-merge branches, and give
`rfp-analyze` a remote — that last one is the only real data-loss exposure and
it is one `gh repo create` away. Correct §2 of the second-pass document rather
than editing it: the project's own journal convention is a forward pointer, not
a rewrite.

**Risk.** Deleting local branches after a squash merge is irreversible if the
squash-merge assumption is wrong for any given branch, so check `gh pr list`
per branch rather than by pattern. Leaving it: the next reader of §2 does the
push, and the noise makes the real item — a repo whose entire history has no
remote — invisible inside a number that is 80% artifact.

---

## Candidate 4 — The issue backlog is the fleet's only human-facing channel and it is filling seven times faster than it drains

```yaml
title: The issue backlog is the fleet's only human-facing channel and it is filling seven times faster than it drains
track: workflow
effort: half-day to triage; the decision is the work
impact: high — it is the delivery layer every other candidate's verdict must pass through
```

**Problem.** Nineteen of the twenty-two existing candidates add a check, a
field, a gate or a report. Every one of them delivers its verdict into the same
channel: an auto-filed or hand-filed GitHub issue in `reddoor-maintenance`.
That channel is saturating on a measured trend, and the closure rate is flat
and independent of the open rate. One candidate correctly identifies the
`gh issue list` 30-row truncation as a mechanism failure — but the truncation
is a symptom of the count, and nobody costed the twenty-two proposals against
the channel's throughput.

**Evidence.** `gh issue list --state all --limit 400` on
`reddoorla/reddoor-maintenance`, bucketed by ISO week of creation and closure:

| week     | opened | closed | net     |
| -------- | ------ | ------ | ------- |
| 2026-W33 | 3      | 2      | +1      |
| 2026-W34 | 7      | 7      | 0       |
| 2026-W35 | 11     | 5      | +6      |
| 2026-W36 | 24     | 4      | **+20** |
| 2026-W37 | 35     | 6      | **+29** |

58 open today. Opening rate rose 3 → 35 per week across five weeks; closing
rate sat between 2 and 7 throughout and did not respond. W36 and W37 together:
59 opened, 10 closed. The existing `--limit` candidate's own evidence shows
what that count does to the mechanism — the workflows' unlimited
`gh issue list` finds #754 and not #652, so a healed condition's issue can
never be closed and duplicates accrete; #652 has been open since 2026-09-01
against a repo that now reports `enabled/enabled`. Both halves compound: the
fuller the list, the more orphans, and orphans never leave.

**Proposal.** Two things, and the first is a decision rather than a task.
(1) Before the meta week adopts any candidate that files an issue, decide what
the channel's throughput actually is and cap the week's additions to it. Seven
new instruments filing nightly into a list that closes five items a week is not
twenty-two improvements, it is one guaranteed regression: an alarm channel
nobody reads, which is the precise end-state the fleet's own history documents
for #652 and #754. (2) Spend an hour closing rather than opening — the 58
include at least one provably healed alarm (#652), the "parked for operator"
items in `08-second-pass.md` §4 which are decisions not tasks, and the
`sharp` wave (A7, 26–31 PRs held open by design) which one sitting resolves.
A backlog that reflects real work is a channel; one that is 40% decisions
nobody has made is a wall.

**Risk.** Triaging by closing things that still matter is worse than the
backlog. Close only: provably healed alarms, duplicates, and items that are
actually questions for the operator (move those out of Issues entirely — they
are not work items and their presence is what makes the list unreadable).
Leaving it: on the current slope the list passes 90 open before October, and
every instrument in this candidate set reports into it.

---

## Candidate 5 — Two live project conversations are running without Tucker in them, and the agency's people layer is invisible to every system he built

```yaml
title: Two live project conversations are running without Tucker in them, and the agency's people layer is invisible to every system he built
track: workflow
effort: hours
impact: medium-high — it is the only candidate about work arriving rather than work shipping
```

**Problem.** The brief and the roster-reconciler candidate both describe
`#worthe` and `#trinity-law-school` as "active client channels with no
repository." Measured, the finding is different and sharper in one direction
and softer in the other: `#worthe` is a month stale, and the two genuinely live
orphan channels are conversations **Tucker has not posted in at all**.

**Evidence.** From `discord-messages.jsonl`, by channel, with last-message
timestamp and distinct authors:

| channel               | msgs         | last message   | authors                           |
| --------------------- | ------------ | -------------- | --------------------------------- |
| `#worthe`             | 100 (capped) | **2026-08-13** | erik, nicole, tim, **tucksravin** |
| `#trinity-law-school` | 33           | 2026-09-03     | nicole, tim — **no tucksravin**   |
| `#roalson-interests`  | 13           | **2026-09-10** | erik, nicole — **no tucksravin**  |
| `#new-business`       | 7            | 2026-08-19     | erik, nicole — no tucksravin      |
| `#schedule`           | 5            | 2026-08-24     | erik, nicole — no tucksravin      |
| `#msot`               | 5            | 2026-08-13     | erik, nicole — no tucksravin      |

So: `#worthe` is the busiest channel by count and has been quiet for thirty
days, which makes "busiest channel with no repo" a truncation artifact rather
than a live gap — the roster-reconciler candidate should not lead with it.
What is live is `#roalson-interests` (two days ago) and `#trinity-law-school`
(nine days ago), and neither has a Reddoor-side participant who is Tucker, an
Airtable row, a repository, or any artefact in any system in this package. All
688 messages across 20 channels are human-authored; **zero bot messages**, so
none of the fleet's reporting, digest, alarm or cockpit output reaches the
place where the work is actually discussed.

**Proposal.** Two separate things that have been conflated. (1) Ten minutes:
ask what `#trinity-law-school` and `#roalson-interests` are. If they are
prospective work the colleagues are running, that is fine and the answer is a
line in the notes; if either is committed work, it is outside every sweep,
every audit and every report, and the roster reconciler proposed elsewhere
should include Discord as a source specifically so this question gets asked
automatically rather than annually. (2) The real finding, which no lens
touched: this is not a solo operation at the business layer and it is a solo
operation at the systems layer. Three other people conduct client work in
Discord; none of them can see a single thing the fleet measures. Before
building more instruments, decide whether any of their output is meant to reach
anyone but Tucker. If the answer is no, that is a legitimate design and worth
writing down — it changes how every alarm in this candidate set should be
delivered.

**Risk.** Piping fleet alarms into shared Discord channels without deciding
which are client-visible would put audit internals in front of clients — the
channels are mixed (per `CLAUDE.md`: `#sonder` contains internal staff **and**
the client). This is a decision to make deliberately or not at all; the
candidate is the decision, not the integration.

---

## Candidate 6 — A 113-field operational base records no contract and no revenue

```yaml
title: A 113-field operational base records no contract and no revenue
track: workflow
effort: hours
impact: medium — it is the axis every prioritisation in this package silently lacks
```

**Problem.** The Airtable `Websites` table carries **113 fields**, including
`Cert days remaining`, `Lighthouse — Best Practices`, `Prismic Models Drift`
and `Security Auto-Fix Attempts`. It carries no field naming a price, a rate,
an invoice, a fee, an amount, a retainer or a term. `maint. contract entered`
is a checkbox and it is **TRUE on 1 of 45 rows**; `contract link` is an
attachment field and it is **empty on all 45**. So the system that knows each
site's accessibility violation count to the integer cannot say which sites pay,
how much, or under what terms — and every ranking in this package, mine
included, has therefore been done without the one axis that would order it.

**Evidence.** Field census over `airtable-Websites.json` (45 rows): 113
distinct keys; regex `price|rate|invoice|fee|amount|revenue|bill|cost` matches
exactly one key, `Security Vulns Moderate`, on the substring "rate". `maint.
contract entered` true: 1 (ERP Industrials). `contract link` non-empty: 0.
`Status = maintained`: 13, which is the closest thing to a revenue signal in
the system and is a hand-edited single-select that also gates every fleet
sweep.

**Why it matters here specifically.** Three of the existing candidates ask
which sites to prioritise — the a11y debt ramp ("scope to the 13 maintained,
not the 24 — the boundary is already the revenue boundary"), the testMode
rollout ("gallerysonder first, since it is the paying monthly client"), the
conformance report ("the 11 generation-1 sites, the ones with revenue
attached"). Each of those is reasoning about revenue from a status field that
does not encode it. That may be right; nothing in the system can check it.

**Proposal.** Not an accounting system. One sitting and three fields —
retainer amount, cadence, and renewal or review date — filled for the 13
maintained rows from whatever the actual source of truth is today (invoices,
memory, the contracts that were never attached). Then a single derived line in
the cockpit: contracted sites whose report has never been sent, which today
would read **12 of 13** and would have surfaced candidate 1 without anyone
reading a Reports table by hand. The instrument is trivial; the value is that
"which client matters most" stops being an inference and the `maintained`
status stops carrying two unrelated meanings at once.

**Risk.** Putting commercial terms in the same base that holds client
credentials and lead data widens what a single Airtable exposure costs — the
credential columns were deliberately cleared and this would partly refill the
table. If that matters, the three fields belong in 1Password or a separate
base and only the derived boolean in Airtable. Leaving it: prioritisation
continues to run on a proxy, and nobody notices when a proxy and reality
diverge, because nothing records reality.

---

## Candidate 7 — Instrument the collapse before theorising about it

```yaml
title: Instrument the collapse before theorising about it
track: workflow
effort: minutes to start; a week to have an answer
impact: medium-high — the largest repeating pattern in the corpus and the only one with no data on its cause
```

**Problem.** The single most repeated shape in 45 days of data is a sharp
output collapse immediately after a peak, and the evidence package explicitly
cannot say why. `08-second-pass.md` §6 names it as an open question and asks
Tucker to answer it in one sentence. He should — but the candidate set contains
nothing that would produce an answer next time, and the meta week is itself a
peak-shaped event scheduled directly after one.

**Evidence.** From the metrics appendix, on the deduplicated basis: Aug 24–26
carries 430 unique prompts and 473 commits; Aug 27–30 carries 58 and 20 — a 90%
input drop and 96% output drop, starting the day after the peak. The same shape
recurs Sep 10 → Sep 11 (146 → 44 prompts) and Sep 06 → Sep 07 (49 → 33, one
repo touched). Weekday distribution shows a **Friday cliff**: 174 unique
prompts against 410–549 Monday through Thursday, lighter than either weekend
day — and Saturday and Sunday together carry 494 prompts, 525 commits and 838
sessions, so **there is no rest day**. Adjacent context: 212 user
interruptions, 288 compaction events clustered on exactly the heaviest days
(41 on Aug 25, 37 on Aug 19), and one verbatim operator prompt from the peak
day itself — _"phew ok, what just happened? my system got overloaded and you
didn't stop your agents when i asked you to."_ Two further facts the package
flags as unresolvable from the corpus: whether those compactions were chosen or
automatic, and what happened on 2026-08-27.

**Proposal.** Do not build anything. Answer the two questions that cost a
sentence each — was the compaction `/compact` or automatic, and what was
2026-08-27 — because they change every context-management recommendation in the
set and no amount of tooling substitutes for them. Then add one line a day to
`docs/workJournal.md` for the duration: date, hours actually at the keyboard,
and a one-word state. Four weeks of that answers whether the collapse is
recovery from overload, deliberate rhythm, or something external, and until it
is answered every proposal about session shape — including the handoff
candidate, which is a good one — is being tuned against a pattern whose cause
is unknown. The journal convention already exists and is already mandatory; this
adds one line to it.

**And treat the meta week as the experiment's first data point.** The week
follows the Sep 5–10 peak. If the pattern holds, the collapse lands mid-week.
Plan the week's items so that the first two days carry the two irreversible
things — the report proof in candidate 1 and the referrer restriction on the
leaked keys — rather than the instrument-building, which survives being
interrupted.

**Risk.** This is the one candidate that is about a person rather than a
system, and a self-measurement that becomes another obligation is worse than
none — one line, no schema, no dashboard. Leaving it: the pattern recurs
roughly every ten days, the meta week is scheduled into it, and the next
analysis run in three months will reach exactly the same "the evidence is
silent on its cause."

---

## Candidate 8 — Delete the dead memory layer, and settle whether the agent layer is code

```yaml
title: Delete the dead memory layer, and settle whether the agent layer is code
track: workflow
effort: hours
impact: medium — small, cheap, and the only subtraction in the whole candidate set
```

**Problem.** Five overlapping memory and context layers are loaded into
sessions on this machine. One of them has never stored anything. It is a
running instance of exactly what the house rule forbids — a mechanism trusted
for 73 days without once being shown to work — and it is paid for in context on
every request. Meanwhile the layer that carries the actual operating knowledge
is excluded from version control.

**Evidence.** `~/.claude-mem/` contains exactly two entries: `logs/` (75
directories, last written 2026-09-11) and `settings.json` (3,481 bytes, dated
**2026-06-10**, the install date). There is no database, no store, no
observation file anywhere under it — the plugin has been invoked and has
logged, for 94 days, and retained nothing. `08-second-pass.md` §5 reaches the
same conclusion from the other direction ("recorded nothing for 71 of the 73
days"). The layer that does work —
`~/.claude/projects/-Users-.../memory/` — holds **119 files** and is the source
of every operational gotcha that made this session efficient. And
`.gitignore:14` is `.claude/`, with `git ls-files .claude` returning **0** in
the central repo, so hooks, skills, agent definitions and settings are on one
disk and in no history, notwithstanding #699 having already settled the
identical argument for `CLAUDE.md` (operator call, reasoning in `50864ff`).

**Proposal.** Three small things. (1) Prove or remove `claude-mem`: run it
once, check whether anything lands, and if not uninstall it — a memory layer
that has stored nothing in 94 days is not a memory layer, and the cost is not
zero because it loads on every session. (2) Write down which of the remaining
layers is authoritative for what, in one paragraph in `CLAUDE.md`, because
right now four of them overlap and a future session has no way to know which to
write to. (3) Decide `.claude/` version control (this is `08-second-pass.md`
§4 A9 and it needs a yes or a no, not a design) — and if yes, note that the
secret-scanning candidates in this set make it a repo that now needs to be
checked for credentials before it is tracked, which is an argument for doing it
in the same week rather than later.

**Risk.** Tracking `.claude/` publishes hook and agent internals to a public
repo, and this org already has five open secret-scanning alerts — scan before
committing, and do it after the alert triage, not before. Removing `claude-mem`
risks deleting a store that exists somewhere I did not look; the check is one
command and it is the prove-the-instrument step. Leaving it: five layers, one
dead, none authoritative, all loaded.

---

# Leave alone — things the candidates treat as problems that are fine

Naming these is the other half of the job. Each one has been checked; each is
either working as designed or already settled, and spending meta-week hours on
it is a loss.

**1. PR cycle time (p50 = 0.3 h, 62% merged within an hour).** This is
auto-merge-on-green working exactly as designed for a single operator with an
explicit merge-authority policy, not an absence of review. The p99 tail of five
days is where contested work actually goes. Do not add review ceremony to a
one-person fleet; it would convert a working mechanism into a queue.

**2. CI at 8.7% failure / 95.5% fleet green.** That is a healthy failure rate.
A gate that never fails is not measuring anything — which is the thesis of six
of the candidates. `ci` failing 132 times in 1,522 runs is the one workflow
doing its job. Do not chase it to zero.

**3. Bimodal session length and 3,186 zero-prompt sessions.** That is subagent
fan-out, not fragmentation: 92% of sessions have no human turn because they
were spawned by the 283 that do. The p50 of three minutes is a measurement of
delegation working. The real context question is the 33 long containers, which
the context-management candidate correctly isolates.

**4. `general-purpose` at 1,040 spawns against `Explore` at 35.** Presented as
30:1 in favour of the least-specified option. No harm has been measured — no
incident, no cost, no wrong answer is traced to it. A `general-purpose` agent
given a read-only prompt does the same work. Do not mandate `Explore` on the
strength of a ratio; if there is a harm, measure it first.

**5. The 12 `archived` and 9 `external` Airtable rows sitting outside every
sweep.** Correct by design. The roster-reconciler candidate is right that the
`Status` boundary is load-bearing and unaudited, but the question is narrow:
the **2 `launching` and 7 `building`** rows, of which hedloc and alamo-anatomy
are live with real URLs. Twenty-one rows are legitimately out of scope and a
reconciler that reports them as gaps will be ignored within a week.

**6. `LA Homelessness Youth` as `maintained` with `freq=None`.** Deliberate and
documented — it is portfolio copy, and `maintained` + `freq None` is the
recorded idiom for "keep it in sweeps, send it nothing." Same for `Roscoe
Martin` and `The Burbank Studios` (`hosted-only`, `freq=None`): they are
report-eligible by status and never drafted because frequency is null. Not a
gap.

**7. `Report recipients (To)` blank on 11 of 13 maintained sites.** Looks
alarming, is fine. `src/reports/preflight.ts:143-151` resolves
`Report recipients (To)` **else `point of contact`**, and `point of contact` is
populated on 14 of the 15 report-eligible rows. The only row with neither is
Roscoe Martin, whose frequency is `None` so it is never drafted. Fleet memory
already records blank-To as the norm. Do not fill 11 cells.

**8. Airtable's plaintext credential columns.** The schema still defines `DNS
password`, `cms password` and `site host password` as `singleLineText`, which
reads as a live exposure. **All 45 rows are empty in all three**; the only
credential cell left anywhere is one `Mailchimp API Key`. This was already
cleared when the creds moved to 1Password on 2026-08-31. Do not re-do it;
optionally delete the empty columns so the next reader does not re-discover
this.

**9. `reddoor-mailer`, `the-pointe`, `rfp-analyze` as sweep-skips.** Documented
in both `CLAUDE.md` files, with a script (`scripts/fleet-repos.sh`) that
reports them. The only new fact worth a line is that `reddoorla/the-tower` is a
fourth archived repo with no local checkout, so the script cannot see it — one
sentence, not a project.

**10. The 38% personal-project share, and `octagonal-led-turn-counter`'s 50.9
session-hours at zero commits.** The package already frames the split as a life
question rather than a data question and it is right. On the specific anomaly:
the project is at
`~/Documents/GitHub/octagonal-led-turn-counter/octagonal-led-turn-counter`, a
nested path the top-level repo walk does not reach — so "zero commits" is a
measurement artifact of where the repo sits, not evidence of 50.9 wasted hours.
Do not open the portfolio-allocation conversation on the strength of that
number.

**11. Four separate secret-scanning candidates.** This is one item, and the
duplication is itself a risk to the week: four proposals converge on the same
five alerts and could easily consume two days. The consensus sequence across
them is right and takes about an hour — restrict by HTTP referrer first, rotate
later, and compare the `whsec_` fixture against the live Resend secret. Note
what the convergence obscures: three of the four candidates rank the Google
Maps keys as high impact, while one of them states the actual position
correctly — `VITE_GOOGLE_MAPS_KEY` is compiled into the shipped client bundle
and served to every visitor, so the git-history leak adds close to zero
incremental disclosure and secrecy was never the control. The browser keys are
a ten-minute console task. The `stripe_webhook_signing_secret` in the central
repo and the two public repos with push protection **off** are the parts that
deserve the attention, and they are the parts a reader skimming four similar
candidates will skip.

**12. The ~90 PR-less `renovate/*` branches.** Two of the nine surveys read the
same branch facts as benign "awaiting schedule" latency, and the mechanism
behind the drought is explicitly labelled _inferred_ in the source research.
Monday 2026-09-14 is two days away and settles it for free. Do not rewrite
`packageRules` in the meta week; run the observation, and build the outcome
instrument, which is useful either way.

**13. The 288 compaction events as a number to act on.** The extraction cannot
distinguish an operator-typed `/compact` from an automatic one, and the
difference inverts the recommendation. One sentence from Tucker settles it.
Building session tooling before asking is the "built on a mechanism without
reading it" failure the house rule exists for.

---

## One note on sequencing

If the week can only carry a handful of things, the ordering constraint is not
severity — it is reversibility and deadline. Two items have external clocks the
meta week does not control: the **2026-10-05 report batch** (candidate 1, which
also constrains when Phase 6 may land) and **Monday 2026-09-14** (the Renovate
observation, which expires if it is not taken that day). Two are irreversible
and cheap: the **referrer restrictions** on the leaked keys, and giving
**`rfp-analyze` a remote**. Everything else in twenty-two candidates plus these
eight is instrument-building, and instrument-building survives being
interrupted — which, given the collapse pattern in candidate 7, is the property
worth sorting on.

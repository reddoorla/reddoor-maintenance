# Priorities — the operating model

**Scope:** how Tucker and his agents actually work. Infrastructure priorities are
in `06-priorities-system.md`; this document tracks only workflow items, plus the
workflow-track additions from the completeness critic and three findings I made
while checking the slate.

**Basis.** Every candidate here has been through the challenge round
(`_research/challenge-refutation.md`, `challenge-evidence-audit.md`,
`challenge-completeness.md`). Items the refuter killed are excluded and named in
§4 with the reasoning kept. Items I measured myself today are marked
**[measured 09-12]**; everything inherited is marked **[measured]** or
**[inferred]** according to which challenge document established it.

> **Two corrections to the brief this document was commissioned under.** The
> orchestrator's framing quotes pre-correction figures from an early draft of the
> metrics appendix. On the deduplicated basis the appendix itself now uses:
> **Thursday**, not Tuesday, is the peak weekday (549 unique prompts); Aug 24–26
> carries **430** unique prompts, not 1,470, and the following four days carry 58,
> not 72. The Friday cliff (174) and the no-rest-day finding survive both bases.
> And `octagonal-led-turn-counter`'s "zero commits at 50.9 session-hours" is a
> nested-path measurement artifact, not evidence of wasted time — the repo sits one
> directory deeper than the walk reached. Do not build an argument on either.

---

## 1. The pattern

**Every control in this operation is a person, and the person is always on.**

The quality bar is real and it is held by hand. One prompt in eight — 348 of
2,693 — demands that an agent prove something, which is the house rule
(_prove the instrument before you trust its verdict_) operating through a human
keyboard. One in five is pure approval: the operator acting as the merge gate,
529 times. 104 of 119 main-thread sessions — **87%** — were interrupted mid-turn
by hand. **[measured]**

None of that is structural, and the measurements say so precisely:

- **15 of 763 merged pull requests carry a review — 2.0%. Fourteen of those
  fifteen are in one personal project (`dont-lose-your-head`); one is in
  `Broken`.** Across the entire Reddoor commercial fleet in forty-five days,
  **zero** merged PRs carried a GitHub review. **[measured 09-12, from
  `prs.jsonl`]**
- **There are zero project hooks.** `.claude/hooks/` does not exist in the
  central repo; the single hook on this machine is a plugin's cache-heal in
  `~/.claude/hooks/`. The most structural lever available — something that fires
  whether or not anyone remembers — is entirely unused. **[measured 09-12]**
- `superpowers:verification-before-completion` was invoked **once** in seven
  weeks, and that once was **today, 2026-09-12**, during the construction of this
  evidence package. It has never fired during real work. **[measured 09-12]**

The counter-evidence matters as much, and it is the reason this list prefers
structure over rules. **Structure, where it exists here, is obeyed.** The
metrics read `using-git-worktrees` invoked three times against a mandatory
worktree rule and the refuter concluded compliance is "near zero". That is a
derived view read as the state itself — the exact failure issue #711 is open
about. `git worktree list` on the central repo returns **five live worktrees**
right now; this document is being written from one. The rule is followed; the
_skill_ is not invoked, because the rule names `git worktree add` directly.
**[measured 09-12]**

So the working hypothesis for this week: the operator's judgement is the
system's strongest component and its only load-bearing control. Items below try
to move a few controls off the person — not to replace the judgement, which is
working, but to stop it being the thing that has to be awake.

The honest cost side of the same pattern: **there is no rest day.** Saturday and
Sunday carry 494 unique prompts, 525 commits and 838 sessions; Friday is the
trough at 174, lighter than either weekend day. A sharp output collapse follows
every peak at roughly ten-day intervals. §2.6 has a partial, measured answer to
why — and it is not the one the evidence package assumed.

---

## 2. Change this week

### 2.1 — Ship the head-branch gate from #623, and make the promotion-authority call

**Rank 1.** The highest-value workflow item in the fleet, it is already
specified, and the entire 25-candidate slate missed it.

**What to do.** Two separable pieces, and the first does not wait on the second.

1. **The gate.** Add a required check on PRs into `main` that fails unless
   `github.head_ref == 'staging'`. One workflow file on `reddoor-website`. It is
   identity-independent, it ships today, and #623 already names it as the half
   that can land ahead of everything else.
2. **The decision.** Choose A, B or C from #623 — reuse the `reddoor-renovate`
   App, a dedicated machine user, or a dedicated GitHub App. This is a 30-minute
   operator call, not a task, and nothing else in #623 can proceed without it.

**Why.** Tucker wrote the requirement himself, in the issue, on 2026-08-26:
_"I want a safe space to push wildly with AI, but you need my eyes and review on
anything that goes out into the wild."_ The issue is titled **"Meta-work week:
give Tucker sole authority to promote staging → main"** — it was explicitly
deferred to this week. It has been open 17 days with **zero comments** and
`updated_at` identical to `created_at`. **[measured 09-12]**

The decisive constraint is stated in the issue and it is correct: _"No branch
rule can separate 'Tucker at the keyboard' from 'Claude with Tucker's token.'
Only a second identity can."_ `required_approving_review_count` cannot help,
because the author and the only approver are the same account.

**Evidence.**

- The convention is mostly working and is leaking at a measurable rate. Since
  2026-08-26, `reddoor-website` merged 42 PRs: **31 into `staging`, 11 into
  `main`. Of those 11, five came from `staging` (the intended promotion) and six
  bypassed it entirely** — #139, #140, #141 (the three that prompted the issue),
  then #148 `chore/bump-ci-workflow-pin`, #151 `renovate/npm-pnpm-vulnerability`
  and #161 `chore/work-journal`, spread across 09-01 to 09-05. **All eleven had
  zero reviews.** **[measured 09-12, from `prs.jsonl`]**
- So the leak is roughly one PR per week, it continued for ten days after the
  issue was filed, and one of the six was a Renovate PR — i.e. it will keep
  happening without a person in the loop at all.
- `reddoor-website` has two active rulesets today (`main: reviewed changes only`
  id 20165612, `staging: no deletion` id 22843978) and **no `head_ref` check
  anywhere in `.github/workflows/`**. **[measured 09-12]**
- Fleet-wide, `staging` exists as a merge target on exactly one repo. The other
  728 merges in the window went straight into `main`. **[measured 09-12]**
- #545 (open since 2026-08-17, one comment) is the fleet-wide version of the same
  flow, deferred twice. It should stay deferred — see "what would make this a
  mistake".

**Effort.** Gate: 2–3 hours including the proof. Decision: 30 minutes. Identity
implementation: leave it out of the week unless the decision is A, which is the
cheapest and also the one #623 argues against.

**Done looks like.** The gate is required on `reddoor-website`'s `main`, and it
has been _proven in both directions before being trusted_: a PR from `staging`
passes (the known-good control), a PR from a feature branch fails (the FAIL
control). Both controls are free — open one throwaway PR of each shape. And
A/B/C is written down in the issue with a date, even if the answer is "not this
month".

**What would make it a mistake.** Rolling it fleet-wide this week (#545). That
is 13+ repos, a Netlify branch-deploy change each, and it converts a one-repo
experiment into a fleet migration inside a week already carrying other items.
Prove the flow on one repo for a month first. Second failure mode: shipping the
gate as a non-required check, where it reports and blocks nothing — check the
ruleset after, not the workflow file. Third: if the identity decision lands on A,
note the issue's own objection — it puts an org-wide App key on a laptop and
conflates the dependency bot with the AI teammate in the audit trail.

---

### 2.2 — Decide the backlog's throughput before choosing what else the week adds

**Rank 2** by sequence more than by size: this is the decision that determines
whether anything else on either priority list survives contact.

**What to do.** Two things, and the first is a decision.

1. Before adopting any candidate that files an issue or adds a nightly alarm,
   state what the channel can absorb and cap the week's additions to it.
2. Spend an hour closing rather than opening. Three specific clusters, named
   below.

**Why.** Nineteen of the twenty-two original candidates _add_ something, and
every one of them delivers its verdict into the same channel: an auto-filed
GitHub issue in `reddoor-maintenance`. That channel opened 35 issues in W37 and
closed 6. **[measured]**

**Evidence.**

- **59 open issues today**, not the 58 several candidates quote. **[measured
  09-12]** Opening rate by ISO week: W33 +3, W34 +7, W35 +11, W36 +24, W37 +35.
  Closing rate: 2–7 every week, flat and unresponsive to the open rate.
  **[measured]**
- The channel's truncation bug is live and dated: on 2026-09-10 the dedupe query
  returned empty past the default 30-row page and filed #754 as a duplicate of
  #652, which is still open and can now never be closed by the close loop. 24
  `gh issue list` call sites, zero with `--limit`. **[measured]** _(The fix is a
  system-track item — it is candidate 14, and it is the highest-confidence item
  on that list. It belongs in `06`, but nothing in this document is deliverable
  without it.)_
- **A correction to the completeness critic's framing, which changes the fix.**
  The backlog is not uniformly saturating. Keyword-classifying all 59 open
  issues: **13 are match-harness**, nearly all filed in a two-day self-review
  burst on 2026-09-09/09-10; 7 security/credentials; 6 data layer; 5
  dependencies; 4 prospect audit; 2 Prismic; 2 a11y. **[measured 09-12,
  keyword-classified, so approximate]** W37's +35 is mostly one subsystem's
  campaign, not a broad flood. That means the honest triage is not "close
  things" — it is _decide whether the match-harness cluster is a work queue or a
  finished audit's residue_, which is one sitting on one subject.

**Effort.** The decision: 20 minutes. The triage: one hour.

**Done looks like.** A number written down — "the week adds at most N new
alarm-filing instruments" — and three clusters resolved: #652 closed by hand with
a note saying what actually healed it; the match-harness 13 either converted into
one tracking issue or accepted as a queue; and the "parked for operator" items
(`08-second-pass.md` §4) moved out of Issues entirely, because they are decisions
and their presence is what makes the list unreadable.

**What would make it a mistake.** Closing things that still matter in order to
make a number look better. Close only provably healed alarms, duplicates, and
items that are questions rather than work. And do not add a backlog dashboard —
that is a twenty-third addition to a list whose problem is additions.

---

### 2.3 — Write the continuity page, and settle whether the agent layer is code

**Rank 3.** Low probability, no partial recovery, and the only item here with no
cheaper version later.

**What to do.** One page at `docs/runbooks/continuity.md` answering six
questions: what runs unattended and what its failure looks like; what is safe to
ignore for a week (answer: almost everything, because no report can go out
without an approval — say so explicitly, it is a feature); what is not (a
lead-path break, which today nothing would notice); where the credentials are and
who can reach them; how to reach clients, per channel; and the Turso restore
steps promoted out of the migration plan. Then decide `.claude/` version control
— a yes or a no, not a design.

**Why.** The configuration that produced 2,622 commits in 45 days exists on one
laptop, in no version control and no backup.

**Evidence.**

- `.gitignore:14` is `.claude/` and **`git ls-files .claude` returns 0 files** in
  the central repo. Its contents today: `settings.json`, `settings.local.json`,
  `.cc-writes/`, `worktrees/`. Every hook, skill and agent definition that makes
  this operating model work is on one disk. **[measured 09-12]**
- **Six runbooks in `docs/runbooks/`, none covering restore, incident response
  or credential recovery.** The Turso restore procedure — rehearsed three times,
  including once against a real hosted target with the real gpg artifact — lives
  inside `docs/superpowers/plans/2026-08-17-airtable-to-turso-migration.md`.
  **[measured]**
- `netlify/functions/approve-report.mts:81` gates every client-facing send on one
  person and one Basic-auth credential, and `src/reports/send/orchestrate.ts:159`
  throws rather than send even if the Airtable flag is set directly. **[measured]**
- The thing that makes this actionable rather than theoretical: **he is not
  alone.** Discord shows at least four participants, and there are channels
  (`#new-business`, `#schedule`, `#msot`, `#rd-marketing`) in which Tucker does
  not appear at all. "Who would do it" has an answer; "what they could act on"
  does not. **[measured]**
- #699 already settled the identical tracked-or-not argument in favour of
  tracking `CLAUDE.md` (operator call, reasoning in `50864ff`). The `.claude/`
  question is the same question with one extra consideration.

**Effort.** Half a day for the page. The `.claude/` decision is 15 minutes; the
implementation, if yes, is an hour plus a credential scan.

**Done looks like.** The page exists, and the one section that can be cheaply
proven has been: hand the restore section to a fresh session with no context and
see whether it can follow it. Include the step the three rehearsals never needed
— `db restore` refuses a non-empty target (`RESTORE refused=target-not-empty`,
`src/cli/commands/db.ts:377`), so a real recovery lands on a **new** database and
`TURSO_DATABASE_URL` must be repointed across Actions secrets and the central
Netlify site. That is the untested half of a thrice-tested procedure and it costs
nothing to write down.

**What would make it a mistake.** Tracking `.claude/` _before_ the
secret-scanning triage in `06`. This org has five open secret-scanning alerts and
28 public repos; committing an unscanned config directory into one of them is how
the sixth happens. Sequence: triage, scan, then track. Second failure mode:
writing a continuity page nobody has read and treating its existence as coverage
— that is the untested-assertion pattern the house rule names.

---

### 2.4 — Declare the rollback window, in writing, with a date

**Rank 4.** One hour, and it removes a contradiction that agents are currently
resolving three different ways.

**What to do.** Run `db parity` by hand once and record the output. Then write
one dated line: either _"the window is closed as of \<date\>, on this parity
evidence"_ or _"it stays open until \<date\>, and here is the nightly job that
keeps it honest."_ Put it in `docs/workJournal.md` and update the comment in
`src/db/freeze.ts`.

**Why it is a workflow item and not a data item.** The code, the comments and the
operator's own statements currently disagree about which store is authoritative,
and **agents read all three**. #698 records that costing two wrong actions inside
a single 2026-09-04 session. The fix is not code; it is making one of the three
sources authoritative and dating it.

**Evidence.**

- #646 open since 2026-08-31T23:57:41Z, **zero comments, `updated_at` identical
  to `created_at`**. Its own gate reads "Execute only after a clean post-flip
  week — this ends the rollback window." **[measured]**
- `src/db/freeze.ts:44-45` still describes the Airtable write as "the shadow for
  the one-week rollback window" — twelve days past its own claim. **[measured]**
- `db parity` exists at `src/cli/commands/db.ts:165` and
  `grep -rn "db parity\|db sync\|import-airtable" .github/ scripts/` **returns
  nothing**. No workflow, cron or script has ever run it on a schedule.
  **[measured]**
- **Narrowing the candidate's own claim, per the refuter and correctly.** "Nothing
  has verified in 12 days that the shadow is intact" overstates it: `freeze.ts`
  documents that the Airtable mirror write is deliberately still allowed to fail
  its caller, so for everything the nightlies write, the shadow's integrity is
  enforced continuously — a divergence reds the run, and run 34696929623
  (2026-09-12) printed `mirrored=13 mirror_failed=0 mirror_missed=0`. The genuinely
  unverified surface is narrower: rows the nightlies never touch — the 17 Reports
  rows and anything outside the 13 maintained. **[measured]**

**Effort.** Under an hour, both halves.

**Done looks like.** A `FLEET_PARITY …` line pasted into a journal entry with
today's date, and one sentence that a future agent reading `freeze.ts`,
`CLAUDE.md` or the issue arrives at the same answer from all three.

**What would make it a mistake.** Treating this as the on-ramp to executing
Phase 6. Phase 6 is the single largest deletion in a 59-issue backlog and it has
an external clock on it — the completeness critic established that five quarterly
reports come due **2026-10-05**, not "late November", on a path that has never
run for any of them. That is 23 days, it halves the runway every existing
document assumed, and it is a scheduled project, not a meta-week line item. The
decision this week is the _ordering_ — does Phase 6 land before or after the
first quarterly batch — and that is a sentence, not a migration.

---

### 2.5 — Pick one worktree location and one home for agent-layer state

**Rank 5.** Thirty minutes, purely structural, and it is the defensible
replacement for the session-boundary rule the refuter killed (§4.3).

**What to do.** Choose one convention for worktree paths, put it in `CLAUDE.md`
next to the existing mandatory rule, and prune the stale ones.

**Why.** The worktree rule is _followed_ — that is the good news in §1 — but
there is no default for _where_, so every session invents one. Three conventions
coexist on the central repo today:

```
/Users/tuckerlemos/Documents/GitHub/reddoor-maintenance                      main
/Users/tuckerlemos/Documents/GitHub/reddoor-maintenance-e2ebudget            sibling directory
/Users/tuckerlemos/Documents/GitHub/reddoor-maintenance-turso-spec           sibling directory
/Users/tuckerlemos/Documents/GitHub/reddoor-maintenance/.claude-worktrees/…  in-repo, one name
/Users/tuckerlemos/Documents/GitHub/reddoor-maintenance/.worktrees/…         in-repo, another name
```

**[measured 09-12]**

**Evidence.** Five live worktrees, three conventions. #623 asks, as an open
question for this exact week, _"What happens to the ~17 stale worktrees in
`reddoor-maintenance` and the stale branches in both repos?"_ **[measured]** And
fleet memory records the cost already paid: _"A stale worktree poisons
archaeology — sibling worktrees park on superseded commits; a MERGED PR was
called 'unpushed'."_ The completeness critic re-derived a live instance of the
same class: of 96 "unpushed" commits, 19 are reachable only from a local archive
tag, four repos count `refs/stash`, and `data-dynamiq`'s nine sit on
squash-merged feature branches. **[measured]**

**Effort.** 30 minutes, including pruning.

**Done looks like.** `git worktree list` returns only live work, under one path
convention, and `CLAUDE.md`'s existing worktree rule names that path. Ride two
five-minute riders here while in the neighbourhood: **give `rfp-analyze` a
remote** (24 commits on `main`, no `origin` at all — the one genuine data-loss
exposure in the whole unpushed-commits finding, and one `gh repo create` away),
and **add the forward pointer** to
`docs/superpowers/specs/2026-08-31-starter-track-split-design.md:74`, which still
instructs `git merge starter/main` — the landmine `CLAUDE.md:194` corrected and
then points readers straight at.

**What would make it a mistake.** Deleting worktrees or local branches without
checking `gh pr list` per branch. A squash-merged branch is safe to delete; a
branch you _assumed_ was squash-merged is not, and that assumption is the same
one that produced the wrong "unpushed" reading in the first place.

---

### 2.6 — Answer the two collapse questions, and add one line a day to the journal

**Rank 6.** Minutes of work, and it changes every context-management
recommendation anyone will make, including Fable's.

**What to do.** Answer two questions in a sentence each — _was the compaction
typed or automatic?_ and _what was 2026-08-27?_ Then add one line a day to
`docs/workJournal.md` for the duration: date, hours actually at the keyboard,
one-word state. The journal convention already exists and is already mandatory;
this adds a line to it.

**Why.** The largest repeating shape in 45 days of data is a sharp collapse
immediately after a peak, and the evidence package explicitly cannot say why. The
meta week is itself a peak-shaped event scheduled directly after one.

**Evidence, including a finding that reframes the question.**

- Aug 24–26 carries 430 unique prompts and 473 commits; Aug 27–30 carries 58 and 20. The shape recurs Sep 06→07 and Sep 10→11. **[measured]**
- **New, and it points away from the person.** All three `/extra-usage`
  invocations in the entire 45-day window fall on 2026-08-27, 2026-08-28 and
  2026-09-06 — that is, on the first two days of the largest collapse, and on the
  evening before the Sep 7 trough (25 sessions, 3.9 session-hours, one repo).
  **[measured 09-12, from `slash-commands.json`]** Two of the three collapses have
  an adjacent usage-ceiling marker; the Sep 10→11 drop has none.
- **Read that carefully.** n=3, `/extra-usage` records that the command was
  invoked, not that a limit was hit or that capacity was purchased, and one
  collapse is unexplained by it. This is **[inferred]**, and it is offered as a
  hypothesis worth one sentence of confirmation, not as an answer. But it is
  enough to say that "the operator crashed after a peak" and "the account hit a
  ceiling after a peak" are both live readings, and they imply opposite
  interventions.
- The compaction ambiguity is real and blocking: 288 compaction events, clustered
  on exactly the heaviest days (41 on Aug 25, 37 on Aug 19), and the extraction
  counts `<command-name>` markers that **cannot distinguish a typed `/compact`
  from an automatic one**. The difference inverts the recommendation. **[measured,
  with the limitation measured too]**

**Effort.** Two sentences now; one line a day thereafter.

**Done looks like.** Both questions answered in the journal, and the week's items
sequenced so the first two days carry the irreversible things — the head-branch
gate here, the referrer restrictions in `06` — and the instrument-building later,
because instrument-building survives being interrupted and a console change does
not.

**What would make it a mistake.** Building anything. A self-measurement that
becomes an obligation is worse than none: one line, no schema, no dashboard. And
do not tune a context-management practice against this pattern until the
compaction question is answered — that is the "built on a mechanism without
reading it" failure the house rule exists for, applied to a person instead of a
gate.

---

## 3. Worth considering

**3.1 — Give the operational record a revenue axis.** _(Completeness critic #6.)_
The Airtable `Websites` table carries 113 fields and not one names a price, rate,
fee, invoice or term; `maint. contract entered` is TRUE on **1 of 45** rows and
`contract link` is empty on all 45. **[measured]** Three of the existing
candidates reason explicitly about "the revenue boundary" from the `Status`
field, which does not encode it — and `Status` is simultaneously the thing that
gates every fleet sweep, so it is carrying two unrelated meanings. Three fields
(retainer, cadence, renewal date) on the 13 maintained rows, plus one derived
cockpit line — _contracted sites whose report has never been sent_, which today
reads **12 of 13** — would have surfaced the quarterly-report gap without anyone
reading a table by hand. Hours, not a system. Held out of §2 because it needs data
only Tucker has, and because putting commercial terms back into the base whose
credential columns were deliberately cleared on 2026-08-31 is a decision, not a
default.

**3.2 — Ask what `#trinity-law-school` and `#roalson-interests` are, then decide
whether fleet output is meant to reach anyone but Tucker.** _(Completeness critic
#5, and it corrects the brief.)_ `#worthe` is not a live orphan — its last message
is **2026-08-13**, a month stale, and its "busiest channel" standing is an
API-truncation artifact. The live orphans are `#roalson-interests` (last message
2026-09-10) and `#trinity-law-school` (2026-09-03), **and Tucker has posted in
neither.** Both are being run by colleagues. **[measured]** Ten minutes answers
whether either is committed work sitting outside every sweep. The larger half is
a design decision: **all 688 Discord messages are human-authored — zero bot
messages** — so nothing the fleet measures reaches the place the work is
discussed. If that is deliberate, write it down, because it changes how every
alarm in both priority lists should be delivered. If it is not, note the risk the
critic names: the channels are mixed, staff _and_ clients, so piping audit
internals into them is not a small change.

**3.3 — Re-measure the unpushed commits before acting on `08-second-pass.md` §2.**
That section reports 159 commits on no remote, frames it as data-loss risk, and
offers to push them. Re-run today the total is **96** (91 pushable), and it
decomposes almost entirely into archive tags, `refs/stash` and squash-merge
orphans. **[measured]** Acting on the offer would push dead branches back to
GitHub. The correct query is `git log --branches --not --remotes`, proven in both
directions first: it must return **0** for `la-homelessness-initiative` (the PASS
control, where the residue is an archive tag) and must name
`beachfront-dentistry`'s `fix/p751-unanchored-score` (the FAIL control, live
work). Correct §2 with a forward pointer rather than editing it — the project's
own journal convention. The one real item, `rfp-analyze`, is already a rider on
§2.5.

**3.4 — Prove or remove `claude-mem`, and name which memory layer is
authoritative.** _(Completeness critic #8 — and step one is already done.)_ I
checked: `~/.claude-mem/` is 500K and contains exactly `logs/` (last written
2026-09-11) and a `settings.json` dated **2026-06-10**, the install date. No
database, no store, no observation file. It has been invoked and has logged for 94
days and retained nothing. **[measured 09-12]** The layer that does work —
`~/.claude/projects/…/memory/` — holds **119 files** and is the source of most of
the operational knowledge that made this research efficient. **[measured 09-12]**
So the remaining work is a 15-minute decision: uninstall the dead layer, and write
one paragraph in `CLAUDE.md` saying which of the survivors is authoritative for
what. It is the only subtraction in either priority list, which is an argument for
it in a week whose main risk is addition.

---

## 4. Not recommending, and why

A priority list that recommends everything is not a priority list. These were
proposed, and they are being left out on purpose.

**4.1 — "Make 'prove the instrument' a machine-checked property of every
scheduled workflow."** _(Original candidate 2, track: workflow.)_

**The disagreement, stated plainly:** the evidence auditor marked this
**CONFIRMED** and the refuter **REFUTED** it. Both are right, about different
things. The auditor verified the _facts_ — `tests/build/` holds gate tests for
exactly six scheduled workflows; `grep -ral release-health tests/` returns zero;
the three without a gate test are exactly `fleet-form-e2e`, `fleet-lighthouse`
and `release-health`; the rule is stated verbatim at
`tests/build/fleet-smoke-workflow.test.ts:30`. Every one reproduces. The refuter
attacked the _proposal_, and the attack is decisive: the proposed meta-check
asserts that a test file exists, spawns the workflow's `run:` block, and has a
clean case exiting 0 — and **a workflow whose `run:` is `exit 0` satisfies all
three perfectly.** Applied to the three failures `CLAUDE.md` names as the reason
the rule exists, it passes the 2026-08-12 GA-credentials gate (built on a preview
path that does no IO) and passes the setup-node probe (whose VERDICT line grepped
the wrong command). An instrument that cannot fail on the failure class it exists
for is an untested assertion with a test runner attached. #711 made the same
argument first and the candidate's own rebuttal concedes it.

What survives is concrete and belongs in `06`, not here: port the `runGate`
harness to the three workflows that lack one. That is bounded and provable. The
generalisation is not, and the reason is worth keeping: _the rule resists
mechanisation precisely because what it guards — does this check measure what it
claims — is semantic._

**4.2 — "Inventory every credential."** _(Original candidate 12, track:
workflow.)_ Refuted, and the auditor marked it **OVERSTATED**, not confirmed, so
it does not qualify for the disagreement exception. Its headline count is wrong
in a candidate whose entire deliverable is an accurate table: the intersection of
the two main credential files is **seven** keys, not nine, and the "and others"
is empty. **[measured]** It budgets a day for a table, much of the "sprawl" it
describes is documented design (the canonical-path-only loader; `process.env`
precedence; Discord's deliberate exception), and it concedes it is blocked on
#710 — `netlify env:set --site <id>` exits 0 and writes nothing, which would make
the inventory wrong the moment it was built. Every credential another item
actually needs is a single lookup, not a census. **Take the residue as riders:**
delete the four dead keys and the eleven legacy `<SITE>_PRISMIC` names; fix or
delete the 401 `GITHUB_TOKEN` (#650), because `CLAUDE.md` points agents at that
file and it hands them a dead credential; decide where `report-edit.env`'s two
keys belong, since `loadCredentialsIntoEnv` reads only the canonical path and
nothing loads that file today. Ten minutes each.

**4.3 — "Make the plan-phase boundary the session boundary."** _(Original
candidate 25 / auditor's 23.)_

**The second disagreement, and the more interesting one.** The auditor marked it
**CONFIRMED** and reproduced every number to the unit: 283 main-thread sessions,
33 holding 5,100 of 5,692 turns and 88,629 of 95,272 tool calls, median span 29.2h,
max 98.2h, 119 auto-compaction preambles. It even found the candidate
_understating_ itself — "104 of 212 interruptions" mixes denominators; against
main-thread sessions it is **104 of 119, 87%**. The refuter did not dispute any
of that. It refuted the _mechanism_: a new mandatory `CLAUDE.md` rule, in a repo
where the enforcement model is prose.

I am siding with the refuter on the mechanism and against its stated reason. Its
argument — that the existing mandatory worktree rule is honoured three times in
3,469 sessions — is itself a derived view read as the state (§1): five live
worktrees say the rule _is_ followed. So the case against a new rule is not
"rules don't work here." It is narrower and better: this repo's rules work when
they name a concrete mechanical act (`git worktree add`) and fail when they ask
for a judgement call at an unmarked moment. "End the session at the plan/execute
boundary" is the second kind. The candidate's own hard evidence says so — on
2026-08-12, _"The pixel-matching program has ENDED"_ was carried **inside** the
compaction summary and violated ~30 minutes later. The instruction survived; the
behaviour did not. A better-authored handoff fixes nothing there.

What I am taking from it instead: §2.5 (a location default, which is mechanical),
§2.6 (answer the compaction question before tuning anything), and four of the
questions in §5. And one free practice nobody needs a rule for: **29 of the 33
heavy sessions auto-compacted and not one of those summaries was reviewed.** When
a compaction notice appears, read the summary and correct it before continuing.

**4.4 — Adding review ceremony to the PR flow.** The 2.0% review rate is the
headline number in §1, and it is _not_ on this list as a thing to fix directly.
p50 time-to-merge is 0.3h and 62% of merged PRs merge within the hour — that is
auto-merge-on-green working as designed for a single operator with an explicit
merge-authority policy, and adding a self-approval step to a one-person fleet
converts a working mechanism into a queue with a rubber stamp on it. The gap
worth closing is the _promotion_ boundary (§2.1), not every merge.

**4.5 — Mandating `Explore` over `general-purpose`.** Presented as 30:1 in favour
of the least-specified option (1,040 vs 35). **No harm has been measured** — no
incident, no cost, no wrong answer is traced to it. A `general-purpose` agent
given a read-only prompt does the same work. If there is a harm, measure it
first; that is the house rule applied to a workflow ratio.

**4.6 — Any new context-management tooling.** Blocked, deliberately, behind one
sentence in §2.6. The corpus cannot distinguish a typed `/compact` from an
automatic one, and the two readings imply opposite interventions.

---

## 5. Leave alone — this is working

Naming these is the other half of the job. Each has been checked and each is
either working as designed or already settled; optimising it away would be a
loss.

1. **The evidence-demand habit.** 348 of 2,693 prompts ask an agent to prove
   something — the single loudest signal in the corpus, and the behavioural
   counterpart of the project's top rule. It is why the fleet is 95.5% green and
   why three false-confident conclusions were caught rather than shipped. Do not
   try to automate it into a checklist; a checklist is exactly the thing that
   passes when the underlying question was never asked.

2. **The terse steering style.** Median prompt 170 characters, 37% under 80. This
   is high-frequency course correction with a human in the loop, not
   under-specification — and it coexists with 45 written plans. There is no
   evidence in the corpus that longer specifications would produce better
   outcomes, and no counterfactual exists to test it.

3. **Subagent delegation.** 92% of sessions have no human turn because they were
   spawned by the 283 that do; p50 session length of three minutes is a
   measurement of delegation working, not of fragmentation. Leave the fan-out
   alone. The real context question is the 33 long containers, which §2.6 and §5
   of the Fable questions handle.

4. **PR cycle time and the 8.7% `ci` failure rate.** Health, not debt. A gate
   that never fails is not measuring anything — which is the thesis of six of the
   original candidates. `ci` failing 132 times in 1,522 runs is the one workflow
   doing its job. Do not chase it to zero.

5. **The worktree practice.** Five live worktrees on the central repo; the
   mandatory rule is being followed. Only the _location_ needs a default (§2.5).
   Do not read the skill-invocation count as the compliance rate.

6. **The work journal and its forward-pointer convention.** Correction-safe by
   rule, already mandatory, already in active use in `docs/workJournal.md` and at
   least one plan. It is the reason this research package could reconstruct beliefs
   as well as facts. It is also the cheapest place to put every written decision
   this list asks for.

7. **Pre-PR review by subagent, as a campaign tool.** `superpowers:code-reviewer`
   ran 249 times, but across only **9 of the 34 days with session coverage**, and
   126 of those on a single day (2026-08-24). **[measured 09-12]** It is
   campaign-shaped rather than routine, and that is a defensible way to use it —
   it is expensive, and it lands where the risk is. Named here so that "2.0% of
   PRs are reviewed" is not read as "nothing is reviewed."

8. **The personal/commercial split, as a question rather than a finding.**
   Personal projects take 38% of unique operator prompts (1,015 of 2,693); `Broken`
   alone has 438, second only to `reddoor-website` and ahead of the central
   orchestrator. **[measured]** The corpus can show the shape and cannot show what
   the time is for — rest, R&D, or substitution all produce the same rows. The two
   heaviest session containers in the entire window are both `Broken` (98.2h and
   54.9h), which is worth knowing if any context-shape intervention is proposed,
   because a handoff ritual scoped to fleet work would not touch either. Presented
   as the shape of it; whether it is right is not a data question.

---

## 6. Open questions for Fable

These are the workflow questions this research surfaced and could **not** settle.
Each names the limit that blocked it, so a fresh pass knows what would and would
not constitute an answer.

1. **Was the compaction chosen or automatic?** 288 events, clustered on the
   heaviest days. The extraction counts `<command-name>` markers and cannot
   separate a typed `/compact` from an auto-trigger. The two readings imply
   opposite interventions — one is a deliberate context discipline worth
   reinforcing, the other is a ceiling worth designing around. **One sentence from
   Tucker settles it; no amount of analysis will.**

2. **What does an actual working day look like?** The corpus records 1,292.7
   hours of session wall-clock over 45 days — 28.7 h/day, which does not exist. It
   sums concurrent sessions, so it is a concurrency index, not attention. **The
   data cannot distinguish "ten hours at the keyboard" from "one hour of steering
   and nine hours of agents running."** Every recommendation about pace, including
   mine, is therefore made blind to the thing it is about.

3. **Is the collapse a person or a ceiling?** §2.6 offers the first partial
   evidence: all three `/extra-usage` invocations in 45 days sit on 2026-08-27,
   08-28 and 09-06 — two of the three collapses. n=3, the third collapse has no
   such marker, and the command records an invocation, not an outcome. If it _is_
   a capacity ceiling, the intervention is scheduling and model selection, not
   rest discipline. Worth a fresh look at the usage data, which this corpus does
   not contain.

4. **Is the 2.0% review rate a risk or a correct adaptation?** Fourteen of the
   fifteen reviewed PRs are in a personal project. Meanwhile 59.8% of merged PRs
   carry at least one comment, and `code-reviewer` ran 249 times. **The corpus
   cannot tell whether pre-PR subagent review substitutes adequately for post-PR
   human review, because no defect-escape data exists** — nothing links a
   production incident back to an unreviewed PR. Is there a way to measure this
   that does not require waiting for the incident?

5. **What is the right unit of work?** Sessions here are scoped by _project_ — 33
   containers with a median span of 29.2 hours holding 90% of operator turns —
   rather than by deliverable. The refuted candidate 25 diagnosed that correctly
   and proposed a rule that would not fire. **No A/B exists:** nobody has ever run
   a deliverable-scoped session here and compared. What would a cheap experiment
   look like, and is the 29-hour container actually costing anything measurable?

6. **Should a rule ever be written, given what fires and what doesn't?** The
   evidence in §4.3 suggests this repo's rules hold when they name a mechanical
   act and fail when they ask for judgement at an unmarked moment — but that is a
   two-point fit (worktrees hold; the pixel-matching stop did not). Is it right?
   And given that **zero project hooks exist**, is the honest answer that the
   next control should be a hook rather than a paragraph?

7. **What is the appropriate capacity for one meta week?** Two priority lists,
   roughly a dozen surviving items, a backlog closing 5–7 a week, one operator,
   and a collapse pattern with a ~10-day period. **The research can rank; it
   cannot size.** A fresh view on what should be _cut_ from these lists — not
   reordered — would be more useful than another candidate.

8. **Is #623's identity problem worth solving at all?** A second identity is the
   only mechanism that can separate "Tucker at the keyboard" from "Claude with
   Tucker's token" — but all three options carry a real cost (an org-wide App key
   on a laptop; a machine account to own; a third App to maintain), and the
   head-branch gate delivers most of the benefit with none of them. Is the
   promotion _authority_ worth the identity, or is the promotion _path_ enough?

9. **Is the subagent fan-out producing work or producing backlog?** 1,040
   `general-purpose` spawns, and 13 of 59 open issues came from a single
   subsystem's two-day self-review burst. **The corpus shows the correlation and
   cannot show the causation** — a thorough audit that finds thirteen real defects
   is a success, and a thorough audit that files thirteen items nobody will action
   is a cost, and they look identical from here.

10. **What is actually missing from both lists?** The completeness critic's
    strongest finding was structural: twenty-two candidates deduplicate to nine
    subjects and every one is a property of the machine, not the business it
    serves. That gap was closed once — the quarterly maintenance report has never
    been produced, and five come due 2026-10-05. It is worth asking whether
    closing it once was enough.

---

_Sources: `01-fleet-current-state.md`, `05-metrics-appendix.md`,
`08-second-pass.md`, and the three challenge documents in `_research/`. Claims
marked **[measured 09-12]** were derived in this session against the live repos,
the live GitHub org and the derived corpus; they are reproducible with the
commands named inline._

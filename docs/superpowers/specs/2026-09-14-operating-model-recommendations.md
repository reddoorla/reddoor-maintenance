# Operating-model recommendations — 2026-09-14

**Status: draft for the operator's approval.** Nothing in §3 ships until this document
is approved (meta-week spec §2.3). Built on `docs/meta-week/10`–`13`, the two census
refuter rounds (`_data/census-refute.json`, `_data/census-refute-cab.json`), and one
adversarial round over a 14-candidate draft of this document: three judges, one
skeptic per candidate told to default to kill, three evidence auditors re-deriving every
number, one completeness critic — 21 Opus agents, 2,394,050 subagent tokens, 52
minutes (`_data/recommendations-round.json`; the draft they read is
`_data/recommendations-candidates-draft.md`). The round returned **0 keep, 3 amend, 11
kill, 13 audit mismatches**, and every kill and mismatch is either carried into this
version or answered in §5.

## 0. How to read this

The operator's priorities, in order: **1** correctness of outcome, **2** quality and
simplicity of code, **3** ergonomics for future work by humans and agents, **4**
maximize work done between prompts, **5** token efficiency, **6** time efficiency.
Every recommendation below names the priorities it serves; none is allowed to buy a
lower one with a higher one.

Three tiers. **Tier 1** is mechanical, proven or provable this week, and ships as a PR or
an operator-applied diff (§7). **Tier 2** is an experiment whose result decides whether a
rule follows; no rule is written before the result. **Tier 3** is worth considering and
either needs a decision only the operator can make or has a small measured payoff.
§5 keeps what was killed, with the reasoning, as the package does.

A constraint that shapes the whole list: the sandbox denies writes under `~/.claude/`
(settings, hooks, skills, agents, workflows), so anything there is a diff for the
operator to apply, not a change a session can make. §7 carries those diffs verbatim.

## 1. How you have been working — the shape, in numbers (ask 1)

Thirty days, 2026-08-14 → 09-14, every transcript on this machine, usage deduplicated
by request (`_data/tokens-by-lane.json`, `tokens-by-repo.json`, `tokens-by-effort.json`;
method in `10-token-meter.md`):

- **76,255 requests; output 66.9M; cache-create 315M; cache-read 13.9B.** The main
  lane re-reads **282,215 cached tokens per request** and owns 74% of all cache reads;
  subagents re-read 74–122k. Per repo the main lane is uniform: Broken 312k,
  reddoor-maintenance 297k, reddoor-website 294k, songbook 284k.
- **Personal projects are about half the output.** Broken 18.0M (26.9%), songbook
  6.3M (9.5%), dont-lose-your-head 3.3M, octagonal-led-turn-counter 1.8M,
  scriptorium-setup 1.1M, caldea 0.9M, plus a-budget and the-bench — ≈32M of 66.9M.
  The Reddoor side: reddoor-website 12.7M (19.0%), reddoor-maintenance 8.7M (13.1%),
  vida-legacy-foundation 5.0M, 29-navy 3.3M.
- **Opus does the working, Fable the judging, and the switch is by hand.** Main lane:
  Opus 28.3M output over 30,147 requests; Fable 5/5.1 10.2M. Broken alone: Opus 12.2M
  of its 18.0M. `/model` was typed 95 times (`_data/slash-commands.json`); a direct
  transcript grep resolves 81 of them to a target — `opus[1m]` 41, `claude-fable-5[1m]`
  26, `claude-fable-5-1[1m]` 12 — and the 14-switch gap is unresolved (bare `/model`,
  most likely). Effort is not a dial: **73,945 of 76,259 requests at `xhigh`** (97%).
- **Compaction is manual and late.** 107 compactions, all manual, none below 462,618
  pre-tokens (p50 491,829); 32 of them in Broken. Redo after compaction, read for by the
  census, is a documented null (0 of 8 nominations confirmed).
- **Fan-out is where the output goes.** `workflow-subagent` is 28.4% of all output; 2,682
  spawns; the startup context per spawn is p50 36k (workflow), 41k (general-purpose),
  43k (code-reviewer), ≈84.4M across all spawns by median × count against ≈7.9M for
  282 main sessions (`12-startup-cost.md`).
- **Blocks are rare and wide.** 243 block records reduce to five local days with one stop
  each; the records are fan-out counts (one wall writes into every lane). The lag from
  a block to "continue" is 57–211 minutes — the operator waits for the reset.
- **Practices already in place**, which this document does not restate: brainstorm →
  plan → subagent-driven execution; worktrees and the head-SHA merge gate; the journal
  and the memory index; `context-mode` for large outputs (4,006 `ctx_*` calls in 30
  days); and, from this week, refuter rounds over evidence packages.
- **Session shapes differ by project.** caldea: 64 main-lane sessions for 916 requests
  (many short ones). Broken: long sessions, 32 compactions, 47 of the 64 block records
  on 2026-09-02, and 3 of the 4 episodes the first refuter round confirmed.

## 2. The pain points that survived a read

Each one is measured; the number that carries it is named. The draft's original nine
were re-cut by the round: two were built on numbers that did not survive the audit
(§4), and the largest measured class had no name at all.

- **PP-A Agents killed in flight when a block lands.** `orphaned-agent`, the structural
  detector built this week from the second refuter round: **13 orphans, `agentTotal`
  89,411,221** — the largest costed kind in the census — of which 5 died on a quota
  rejection and 8 on an interrupt; 3 were re-dispatched, 10 never re-sent. The three
  killed #569 review lenses cost 32,729 output tokens and ≈1.57M context before the
  block; six research agents in Broken were cut off within two seconds of "kill them" on
  2026-08-24T23:52Z and never re-sent (`11-wasted-work-census.md` §Confirmed,
  §orphaned-agent). The resume itself is cheap: ten of eleven block-resume windows cost
  one or two tool calls.
- **PP-B Claims that do not survive a read.** 16 of the first lever survey's claims
  refuted on the docs; 27 of 31 first-round census nominations and 10 of 11 second-round
  refuted on read; 3 of 3 S1 brief claims wrong on contact, 2 already in fleet memory;
  and this document's own draft: 11 of 14 candidates killed, 13 numbers corrected, and
  the round itself read a worktree five commits behind `main` (§4). This is the
  dominant measured failure of the operation, and it is not a token problem.
- **PP-C Instrument-blind waste.** Gates that are green on questions they cannot fail:
  #782 (`Analytics soft-fail at` field absent — the digest signal can never fire), the
  S5 `total=0` hole and release-health's unset-output guard (#780), the 2026-08-12 trio.
  No census heuristic can see this class; the census's own detectors have no positive
  control on real data except the one built for `orphaned-agent`.
- **PP-D Context per call.** 282k cached tokens per main-lane request, compaction at
  ≥462k. A token fact, not yet a cost fact: no source states how cache reads weigh
  against the Max plan's limit (`13-research.md` §Not found). This session's own
  requests re-read a median 374k (measured by the meter on this session, not in the
  package).
- **PP-E Model and effort are not dials.** 97% `xhigh`; workflow subagents on Opus at
  12.8M output; `maxEffortLevel` (settings-level, any file scope,
  settings-reference.md:1007) and per-stage `effort` in workflows both exist and neither
  is used.
- **PP-F The plugin layer, one broken piece and the rest unmeasured.** `claude-mem`'s
  six hook events all fail "Bun not found" (216 errors in one session transcript, 88
  transcript files carry the string), each first spawning a login shell, for 4 MCP calls
  in 30 days. The rest is unmeasured: `12-startup-cost.md` says in bold that the ≈53k
  opening cannot be attributed from transcripts, the skill listing is already capped at
  1% of the window (`skillListingBudgetFraction` 0.01), MCP tools are deferred by default
  (`ENABLE_TOOL_SEARCH` unset), and `claude-session-driver`'s hooks exit immediately when
  no worker file exists. `context-mode`'s SessionStart injects a 4.6KB routing block at
  startup and a resume directive on compaction (≈16KB per compaction observed in this
  session).
- **PP-G Overload and the open lid (#776).** The confirmed 2026-08-24 episode: six
  parallel agents on a machine also running Chrome, "my system got overloaded". Remote
  Control does not survive a closed lid (`13-research.md` §Off the laptop).
- **PP-H Broken.** 26.9% of all output, the highest per-request context (312k), 32 of
  107 compactions, 3 of 4 first-round confirmed episodes, six orphaned research agents.
  The operator put personal projects in scope; the evidence puts Broken first.

## 3. Recommendations, ranked

Format per entry: pain · mechanism · proof plan (PASS control and FAIL control) · effort
· what would make it a mistake · the outside pattern it adapts (`13-research.md`) ·
serves.

### Tier 1 — mechanical, ship this week on approval

**R1. Turn off `claude-mem`.** _PP-F._ Set `"claude-mem@thedotmack": false` in
`~/.claude/settings.json` `enabledPlugins` (do not delete the key: `false` is the
plugin's own kill path — its `bun-runner.js` tests `=== false` and exits 0, so any
still-registered hook self-silences). One action; the "or install Bun" branch is
dropped because nothing measures what the plugin costs when it works. **Proof:** FAIL
control = a scratch session with three tool calls today shows three
`hook_non_blocking_error … Bun not found` attachments in its transcript file; PASS =
the same three calls after the change show zero. Read from the transcript, not the UI.
**Effort:** 5 minutes, reversible. **Mistake if:** the operator wants `claude-mem`'s
recall — 4 calls in 30 days say no; ask once. **Pattern:** none needed; this is the
house rule (an instrument that has only ever failed is the suspect). **Serves:** 1, 3, 6.
Diff in §7.

**R2. Deny the destructive git verbs globally.** _PP-B, correctness._
`~/.claude/settings.json` has **no** `permissions.deny` block, while its 1,020-entry
allow list carries `Bash(git reset:*)`, `Bash(git stash:*)`, `Bash(git merge *)` and
`Bash(git push *)`. The project settings for `reddoor-maintenance` already deny
`git push --force*`, `git reset --hard`, `git clean -fd*`, `rm -rf` — copy that block
to the global file so personal projects get it too, and add `Bash(git stash)` and
`Bash(git stash pop:*)` (bare stash and pop are the two verbs the worktree rule forbids;
`git stash push -u -m` stays allowed). **Proof:** PASS = after the change, `git reset
--hard HEAD` in a scratch repo is refused (the deny fires); FAIL control = before the
change the same command runs (it is allow-listed today). **Effort:** 10 minutes of the
operator's. **Mistake if:** a deny pattern is broader than the verb (deny matches the
prefix; `Bash(git stash)` must not match `git stash push`) — the PASS control includes
`git stash push -u -m t` succeeding. **Pattern:** P27's test — incident-grade rules
belong in the enforcement layer, not CLAUDE.md (`13-research.md` §Rejected).
**Serves:** 1. Diff in §7. _(Amended from the draft's "permission hygiene", which the
skeptic killed: pruning the allow list has no measured effect; the missing deny block
does.)_

**R3. Account for agents killed at a block, and re-dispatch them.** _PP-A, the largest
measured class._ Two halves. **(a) The report:** at session start after a block or a
resume, run the census's proven detector on the current session and say what died:
`node scripts/meta-week/census.mjs --class fanout --kind orphaned-agent --session <id>`
prints each orphan's `description`, `agentType`, `lastStatus` and whether a
`redispatched` call already exists, and the operator (or the session) re-dispatches
by description. The mechanical form is a `SessionStart` hook (matcher
`resume|compact`) in the project's `.claude/settings.json` that runs it and returns
`additionalContext` — an operator-applied diff, because the sandbox denies the write.
**(b) The record at the moment of death:** a `SubagentStop` hook receives `agent_id`,
`agent_type`, `agent_transcript_path` and `last_assistant_message` (DOC-CONFIRMED,
hooks.md:2360-2385) and can append them to a per-session file; whether it fires when
the harness kills the agent on a quota rejection or a `TaskStop` is **unverified** and
is step 0 of its proof. **Proof:** (a) PASS = on session `04ebfa83…` (2026-08-24) the
report lists the three #569 lenses with their 21:33 re-dispatch ids; FAIL control = on a
session with no orphans it prints nothing. (b) step 0: dispatch a scratch agent,
`TaskStop` it, read whether the hook fired; PASS = one line appended; FAIL control = a
completed agent appends nothing (or a `completed` line, whichever the hook can tell).
**Effort:** (a) the detector exists (built and proven this week: 32,729 output tokens
for the three lenses, difference 0 from the critic's figure); the hook is ~20 lines.
(b) an hour after step 0. **Mistake if:** the report is read as "re-run everything" —
it lists candidates; the session decides. **Pattern:** the census critic's own measure;
P13 (know what is still running). **Serves:** 1, 4, 5.

**R4. A standing refuter round for evidence packages and plans, as a saved script.**
_PP-B only._ Generalise `census-refute.workflow.js` (94 lines; one skeptic per claim,
default refuted, verbatim quote required; then a completeness critic) into a
`refute-claims` script under `scripts/meta-week/` today and under `.claude/workflows/`
once decision A9 (`.claude/` tracking) is made; the `Workflow` tool takes it by
`scriptPath` either way. Rules learned this week, written into the prompt: the evidence
must be on disk (skeptics refute prose from priors); **the evidence checkout must be at
`main`'s head** (this document's round read a worktree five commits behind and killed
one candidate on markers that exist on `main`); and the round's cost is stated up front
— ≈2.0M subagent tokens per 31 claims, 2.4M for 14 candidates with judges and auditors.
**Proof:** PASS control = the round on the lever survey, re-run from the saved script,
still finds the hook-contract error the docs confirm; FAIL control = a package with one
seeded false claim ("the session limit window is 4h") loses exactly that claim. Neither
has been run in the saved form; both run before the script is called proven.
**Effort:** two hours. **Mistake if:** it is run on every small brief — it is for
packages and plans above ~10 claims, and only where the evidence is on disk.
**Pattern:** adversarial verify (workflow reference); no published equivalent of the
house rule was found. **Serves:** 1, 3. _(Amended: the draft also claimed PP7; it does
not address it — the skeptic was right.)_

**R5. The monotone-gate audit: any machine line that has never varied is unproven.**
_PP-C, priority 1._ A nightly job over the last N runs of the fleet workflows that reads
each machine line — `FLEET_WRITE_SUMMARY`, `PROTECTION_AUDIT`, `FLEET_SMOKE_UNMEASURED`,
`RENOVATE_DISPATCH_SUMMARY`, `DUMP_VERIFY`, `FLEET_FORM_E2E`, and since #784
`RENOVATE_OUTCOME` — and lists every field whose value has never changed since its
introduction, as a cockpit "unproven instrument" chip with an ack that expires (as the
Prismic drift ack does). **Proof:** PASS control = `PROTECTION_AUDIT gaps=` is **not**
listed (it moved 0 → 4 on 2026-09-14 when S3 added the open-alerts clause); FAIL
control = `RENOVATE_OUTCOME` (one observation) and the digest's `Analytics soft-fail`
signal (never fired, #782) **are** listed. **Effort:** a day; a Lane 2 item for next
week. **Mistake if:** a hard invariant that legitimately never fails nags forever —
that is what the expiring ack is for. **Pattern:** the census critic's "instrument-blind
waste" measure; P18 (verify, do not review). **Serves:** 1. _(Amended: the draft named
`RELEASE_STATE` and `NPM_DRIFT` as inputs; they are `GITHUB_OUTPUT` values written by
#780, not log lines — the inventory above is what the workflows actually print. The
draft's FAIL control credited #779; the `skipped=N` line is #780's.)_

**R6. The stop runbook, verified.** _PP-A, PP-G._ `TaskStop` by id was proven this
afternoon: two Haiku agents dispatched six seconds apart, one stopped by id, the roster
read `killed` / `running` (`scratchpad/verify-taskstop.md`). `TaskStop` is a deferred
tool and needs one `ToolSearch` first — the 2026-08-24 session spent four of its six
stop calls loading it. One line for global CLAUDE.md: "To stop agents: `TaskStop <id>`
(load it with `ToolSearch select:TaskStop` first); to stop everything: `Ctrl+X Ctrl+K`
twice within 3 seconds (docs), **not** `Ctrl+F` (community)." **Proof:** the chord is
a keyboard action: the operator presses it once with two scratch agents live and reads
the roster; PASS = both stopped, FAIL control = `Ctrl+F` twice does nothing.
**Effort:** 10 minutes. **Mistake if:** the line grows into a runbook nobody reads.
**Pattern:** P13. **Serves:** 1, 4. _(This is what survives of the draft's C3; its
"resumable harness" half was killed — the killed-verify-lanes episode was already a
Workflow run, and resume replays completed agents, not killed ones. R3 is the answer.)_

### Tier 2 — experiments first; the result decides whether a rule follows

**R7. Which concurrency cap binds, and whether a lower one is wanted.** _PP-G._ With no
other agents live, dispatch eight Haiku agents in one message, each printing
`date +%s`, sleeping 25 s, printing again; count overlapping intervals. Docs say
`CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY` (default 10) binds before
`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` (20). If the operator wants a hard ceiling for
#776's overload, the same experiment in a session started with the variable at 4
(settings `env`, §7) is the PASS control; today's is the FAIL control. **Do not set
the value before the experiment.** The 08-24 overload was six agents under a cap of
ten, plus Chrome; R11(a) addresses it more directly than a number.

**R8. Effort and model per stage — A/B before any dial moves.** _PP-E._ On the next
refuter round, judge six candidates twice: Opus at session effort, and Sonnet at
`effort: "medium"` (Workflow `agent()` opts, verified live this week). PASS for the
cheaper tier = verdicts agree on ≥5 of 6 and the reasons cite the same lines; the FAIL
control is a deliberately hard candidate (the vida episode, where the nominated anchor
was wrong) — if the cheap tier confirms on the cited prompt, judging stays on Opus.
Only after that: per-stage `effort`/`model` in workflow scripts for mechanical stages,
and `maxEffortLevel` in a **project** settings file where the A/B held (never the
judging lane). Note the correction: the PATH CLI 2.1.92 ran zero interactive sessions,
so it does not block `CLAUDE_CODE_SUBAGENT_MODEL`; the reason not to set that variable
is that it is coarser than per-stage and never touches Explore/Plan.

**R9. Measure the opening before pruning anything else.** _PP-F._ Two fresh sessions in
the same repo, one with the current plugin set and one with `figma`,
`superpowers-developing-for-claude-code` and `claude-session-driver` off; read the first
call's `cache_creation_input_tokens` from the transcript (`token-meter.mjs --startup`).
The skill listing is already capped at 1% and MCP tools are deferred, so the draft's
expectation that pruning moves the 53k is probably wrong; the A/B says. No prune is
recommended before it, and `claude-session-driver` is kept for #776 regardless.

**R10. What cache reads cost against the limit — the one unknown that decides the
context question.** _PP-D._ Two data points: the operator reads `/usage` now and reports
the weekly percentage; the meter's week-to-date (out, cache-create, cache-read) against
the measured ceiling week (out 18.7M, cache-create 69.9M, cache-read 4.35B = 100%)
bounds the weight. Then the only local test `13-research.md` names: two comparable
sessions, one with `promptCacheTtl: "1h"` (v2.1.242+, the extension qualifies), `/usage`
before and after each. Until this is known, no recommendation may claim tokens for
reducing cache reads; the killed C8 (session per deliverable) is the example.

**R11. Off-laptop and overload (#776) — split, and one half is a rule now.** _PP-G._
**(a)** No local Chrome/Playwright while agents run in an interactive session; browser
checks belong on Actions runners (they already are for form-e2e) — one CLAUDE.md line,
PASS = a week with agents and no local browser and no overload. **(b)** Correction to
the draft: Remote Control keeps files local but is a foreground process — closing the
lid, losing network for ~10 minutes or rebooting kills it; it does not solve the open
lid. **(c)** A second machine is a decision, not a recommendation: it relieves the lid
and the local overload and relieves nothing about the plan's usage limit, which
`13-research.md` §Off the laptop identifies as the binding ceiling. If wanted, the spike
is half a day and its first output is the credential story (`~/.config/reddoor-maint`,
`gh` auth, the sandbox boundary do not travel).

### Tier 3 — worth considering; small payoff, or the operator's call

**R12. Broken.** _PP-H._ Nothing Broken-specific survived the round as a rule, and the
evidence says which general items bite there: R3 (six orphaned research agents, the
most expensive single episode in the census), R11(a) (Godot renders and screenshots
alongside agents on the same machine — the 08-24 overload was Broken's), and R7. The
one thing not to do is the killed C8: Broken's 32 compactions are at task boundaries
by the operator's hand and the census found no redo after any of them. What Broken
would benefit from measuring: its own weekly meter line (`--by week,repo,lane`), so the
26.9% is a number the operator sees, not one the meta week found.

**R13. The compaction handoff already exists — measure it, do not build another.**
_PP-D._ `context-mode` owns a `PreCompact` hook that writes a `compaction_summary` event
to its session DB and a `SessionStart` hook that, on `source === "compact"`, injects a
resume directive from it (marked consumed). That is `13-research.md` P6 in place. The
draft proposed the opposite lever and never named this one. What is worth doing: read
what the directive contains after one compaction (`hook_success:SessionStart:compact`
attachments in the transcript, ≈16KB each this session) and decide whether it is the
handoff wanted, before any competing `PreCompact` hook is written.

**R14. The worker-brief template, as a file with an unproven proof plan.** _PP-B._ The
template used for S2–S7 this week (memory grep before code; read the implementation of
any mechanism built on; corrections recorded, never improvised around; results as a path
plus a ≤15-line summary; the controller reads the artifact) goes into the repo as
`docs/superpowers/templates/worker-brief.md`. The skeptic killed the draft's proof plan
as one-sided — the PASS observation ("S3's worker cited the memory file") is not on
disk. The honest proof: the next two Lane workers, one briefed with the template and one
without, with their transcripts as the artifact. Ranked here, not in Tier 1, until that
runs. **Serves:** 1, 3, 5.

**R15. Path-scoped rules for the fleet-sweep traps.** `.claude/rules/*.md` with `paths`
frontmatter (DOC-CONFIRMED, memory.md:199-206) can hold the archived-repo trap and the
`fleet-repos.sh` instruction so they load only when a session touches
`scripts/fleet-*` or `.github/workflows/`, instead of in every session's opening. The
token value is small (≤5k of a 53k opening); the value is adherence — a rule that
arrives next to the file it governs. Needs A9.

**R16. A capability index for the shared package surface.** `13-research.md` P11; no
such index exists in the tracked tree (the meta-week spec cited a
`scripts/capability-index.mjs` that is not there). The measured case is PP-B's "built
on an unread mechanism"; the proof would be a worker asked to add a form-ingest feature
with and without the index, judged on whether it reused `captureDeadLetter` and
`makeLazySiteLookup` (#785's two new seams). Worth a day if PP-B recurs after R4 and
R14.

**R17. A claim file for agents dispatched inside one sweep.** `13-research.md` P16; the
human-level protocol exists in CLAUDE.md ("claim fleet signals before triaging them").
The census blind spot it answers — cross-session duplication, the six duplicate-fix PRs
of 2026-07-09 — is real and unmeasured by any heuristic. Low cost, no measured
frequency; consider when two sessions next share a sweep.

**R18. Two things the meter found with no owner.** `subagent:unknown` carries 43.8% of
all uncached input tokens (699,424 of 1,596,613) in 0.9% of requests, unattributable to
any agent type; and 600 subagent-lane prompts whose entire text is `"Warmup"` come from
an unidentified mechanism. Neither is a recommendation; both are a question for the
next meter pass (`10-token-meter.md` §Caveats, `11` §cannot see).

## 4. What the round found wrong with the draft of this document

Kept here because it is the most useful section for the next person who writes one.

- **Numbers.** 76,150 requests / 66.7M output were the meter's first run; the committed
  file says 76,255 / 66.9M (the corpus grew while the day ran). "0/16 redo after
  compaction" is the class null; the compaction kind is 0/8. `context-mode` 2,171 calls
  was a prefix tally; the tool census says 4,006. `claude-mem` 3 → 4. `episodic-memory`
  121 → 139. "Three of the four refuted same-turn nominations were `/model`" — one was
  `/model`, one `/compact`, one a post-crash resume, and the fourth was confirmed.
  "81 model switches" is a transcript grep; the only on-disk count is 95.
- **Invented.** "A fan-out launched at 95% of the 5h window" — no such figure exists;
  the three measured session walls fell at 27–49% of the window. `~/.claude/statusline.sh`
  as a mechanism — the research pass had already corrected that to the `statusLine`
  settings key. Remote Control "so the lid can close" — the research says the opposite.
- **Unsourced.** "Most of the 1,020 allow entries are other clients'" — only 118 name a
  GitHub path and 78 of those are Reddoor repos. "Rules are not sent to the model" — no
  doc line either way. The six operator decisions were in the session's scratchpad, not
  in `docs/meta-week/`.
- **Built on a stale base.** The round's evidence checkout was `docs/meta-week-plan`,
  five commits behind `main`; one skeptic killed C11 for naming `NPM_DRIFT` and
  `RELEASE_STATE`, which #780 had put on `main` that morning. The memory file "a stale
  worktree poisons archaeology" was written for exactly this and did not reach the
  round's prompt. R4 carries the fix.
- **The draft's own rule broken.** Its header promised every number re-derivable from
  `docs/meta-week/`; three were not. Two candidates (C10, C11) rested on inputs asserted
  rather than read — the failure `CLAUDE.md` names.
- **Not answered.** Ask 1 had no working-pattern section (now §1). Ask 3's patterns were
  cited for levers only (now named per entry). Personal projects appeared twice, both in
  a killed candidate (now §1, PP-H, R12). Priority 2 appeared in no "serves" line —
  still true of most entries, and honest: this document changes how work is dispatched
  and checked, not the code the fleet runs on, except R5.

## 5. Killed, and why (kept for the record)

- **C2 as written — a concurrency cap of 4 set now.** The one confirmed fan-out episode
  is post-stop in-flight spend that a cap of 4 would not have recalled, under a default
  cap of 10 that six agents did not reach; and `continue-after-block` (out 1.5M) is 173×
  the `spend-after-stop` kind the candidate was built on. Survives as R7's experiment.
- **C4's proof plan.** One-sided: the PASS observation is not on disk. The template
  survives as R14 with an honest proof.
- **C6 — a statusline with context and rate limits.** Its pain line was invented (the
  95%), its mechanism path was already corrected by the research pass, and the killed-
  verify-lanes episode it cites is not a budget-fraction event. The measured need it
  gestured at is R10's unknown.
- **C7 as written.** Lever real; killed for trading correctness for tokens on judgement
  stages with no A/B. Survives as R8's experiment.
- **C8 — session per deliverable.** The FAIL control (a week of unchanged practice shows
  no fall) is already falsified by the corpus's week-to-week noise; the token claim rests
  on the unknown in R10; the correctness claim contradicts the census's compaction null.
- **C9 — prune the plugin layer.** The 53k opening cannot be attributed from transcripts
  (`12` says so in bold), the skill listing is already capped, MCP tools already deferred,
  and `claude-session-driver`'s hooks exit immediately. Survives as R9's measurement;
  `claude-mem` alone survives as R1.
- **C10 — a CI check that PR bodies contain "PASS" and "FAIL".** Its own PASS control,
  #780's body, contains one "PASS" and eight "FAIL"s that are pasted vitest output — a
  grep would green-light a log paste. A gate that cannot read evidence is the class
  §PP-C is about. The habit stays a habit.
- **C12 — a per-project default model.** No on-disk artifact attributes a `/model` switch
  to a repo; the one recorded `opus[1m]` group spans Broken, beachfront-dentistry and
  reddoor-maintenance; and the census priced the switch at zero. Nothing to fix.
- **C14(b) — Remote Control for the closed lid.** Refuted by the research it cited.
- **From the draft's own rejections, still rejected:** `--max-budget-usd` as a kill
  switch (print-mode only); `CLAUDE_CODE_SUBAGENT_MODEL` globally (coarser than
  per-stage; never touches Explore/Plan); aggressive auto-compaction as a rule (the
  compaction null); a CLAUDE.md diet for tokens (≤5k of 53k); rewriting Renovate presets
  (mechanism inferred, not measured); a `Stop`-hook completion gate (block cap
  unconfirmed; the class §PP-C is about).

## 6. Decisions only you can make

Collected, not added. Items 1–6 are Lane 2's from Monday; 7–9 are this document's.

1. Approve or reject the queued Reddoor Maintenance report (row `recVCP3qWUi71B15H`).
   Read the 510% analytics line first; it is real.
2. Before 2026-10-05: four sites fail the pre-send health gate on one high vuln each
   (data-dynamiq, espada, vineyard-custom-homes, revogen) and LA Homelessness Initiative
   on an unknown CMS check. Lane 2 can clear the vulns on your word.
3. Phase 6 ordering on #646: a dated go, before or after 10-05. S4's recommendation:
   after. #645 landed today (#785), so the plan's own precondition is met.
4. Tick `unpend-branch` on reddoor-starter #97, or leave it for the S7 metric (#784) to
   observe. The mechanism is still unresolved: Renovate says "pending status checks",
   GitHub says combined status `success` with zero check runs.
5. GCP console: referrer restrictions on the three Maps keys; validity checks in the
   GitHub UI (the API ignores the write on Free).
6. MSOT and Revogen resolve to the same report recipient
   (`accounting@revogenbiologics.com`). Fix the cell before 2026-11-21.
7. `.claude/` tracking (A9): R4's saved location, R15 and the R3(a) hook ship as
   tracked files only if yes. Today `CLAUDE.md` is tracked and `.claude/` is not.
8. R1 and R2: apply the two diffs in §7, or say no.
9. #776: R11(c) — spike a second machine, or not, with the caveat that it does not
   move the usage ceiling.

Plus one reading, not a decision: `/usage` now, for R10.

## 7. Operator-applied diffs

The sandbox denies these writes; they are yours to apply. Each is the whole change.

**R1 — `~/.claude/settings.json`, `enabledPlugins`:**

```json
"claude-mem@thedotmack": false
```

**R2 — `~/.claude/settings.json`, new `permissions.deny` (the project block plus the two
stash verbs):**

```json
"deny": [
  "Bash(git push --force:*)",
  "Bash(git push -f:*)",
  "Bash(git push --force-with-lease:*)",
  "Bash(git reset --hard:*)",
  "Bash(git clean -fdx:*)",
  "Bash(git clean -fd:*)",
  "Bash(git stash)",
  "Bash(git stash pop:*)",
  "Bash(rm -rf:*)",
  "Bash(rm -fr:*)"
]
```

**R7 — only after the experiment, and only if a ceiling below 10 is wanted —
`~/.claude/settings.json`:**

```json
"env": { "CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY": "4" }
```

**R3(a) — `reddoor-maintenance/.claude/settings.json`, once A9 says `.claude/` is
tracked (otherwise the same block in the operator's local settings):**

```json
"hooks": {
  "SessionStart": [
    {
      "matcher": "resume|compact",
      "hooks": [
        {
          "type": "command",
          "command": "node scripts/meta-week/census.mjs --class fanout --kind orphaned-agent --session \"$CLAUDE_SESSION_ID\" --hook"
        }
      ]
    }
  ]
}
```

(The `--hook` flag, which prints `{"additionalContext": …}` instead of the table, and
the `--session` filter, are the one change R3(a) needs in the detector. Hook commands
receive `session_id` in the JSON on stdin (the hook contract in `13-research.md`);
whether `$CLAUDE_SESSION_ID` is also exported is unverified and is step 0 of the proof —
if it is not, the command reads stdin instead.)

## 8. Verification still owed before anything in Tier 1 is called done

- R1: the three-call PASS/FAIL transcript read, before and after.
- R2: the deny fires on `git reset --hard HEAD` and does not fire on
  `git stash push -u -m t`.
- R3(a): the session-`04ebfa83` PASS and an empty-session FAIL; the session id
  reaching the hook (stdin JSON or env). R3(b): does `SubagentStop` fire on a kill.
- R4: both controls in the saved form.
- R5: `PROTECTION_AUDIT` not listed, `RENOVATE_OUTCOME` listed.
- R6: the chord, pressed once by the operator.
- The week's own spend, from the meter, in Thursday's journal entry, against the soft
  cap (out 11.2M, cache-create 41.9M, cache-read 2.6B): Monday's day ran at 8% of the
  output cap by mid-afternoon.

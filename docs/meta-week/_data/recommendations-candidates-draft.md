# Operating-model recommendations — candidate set (pre-judgement draft, 2026-09-14)

This is the GENERATION step of spec §2.2.3. Every candidate below is a nomination, to
be judged, refuted and audited before it reaches the operator. Numbers cite their
source file; an auditor should be able to re-derive each from `docs/meta-week/`.

## 0. Priority order (operator's, in order; the judge scores against these)

1. correctness of outcome
2. quality and simplicity of code
3. ergonomics for future work by humans and agents
4. maximize work done between prompts
5. efficiency of tokens
6. efficiency of time

Constraints: Max 20x plan, weekly reset Sunday 02:00 PDT; one operator; sessions run
in the VS Code extension (2.1.232–2.1.270 across the last 30 days, 2.1.263–270 now;
the CLI on PATH is 2.1.92 and ran zero interactive sessions); the sandbox denies writes
to `~/.claude/settings.json`, `~/.claude/hooks`, `~/.claude/skills`, `~/.claude/agents`,
so anything there is handed to the operator as a diff.

## 1. Measured pain points (source in brackets)

- **PP1 Context per call.** Main lane re-reads 282k cached tokens per request, 74% of
  all cache reads; subagents ~90k. 107 compactions, 100% manual, none below 462,618
  tokens (p50 491,829). Aug 14→Sep 14: 76,150 requests, out 66.7M, cacheCreate 315M,
  cacheRead 13.9B. [10-token-meter.md; `_data/tokens-by-lane.json`,
  `tokens-compactions.json`]. Fable's own meta-week session: 374k re-read per request.
- **PP2 Fan-out breadth and stopping.** `workflow-subagent` is 28.4% of all output;
  2,682 spawns paid ≈84.4M tokens of startup context (p50 36k per workflow spawn, 41k
  general-purpose, 43k code-reviewer) against ≈7.9M for 282 main sessions [12-startup-
  cost.md]. One confirmed overload: 2026-08-24 "kill them", six parallel agents, three
  requests landing after the stop, operator: "my system got overloaded" [11-wasted-work-
  census.md §Confirmed]. No native budget kill switch for interactive fan-out
  (`--max-budget-usd` is `--print` only) [13-research.md]. Caps that exist:
  `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY` default 10 (binds first),
  `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` default 20 [13-research.md quotes].
- **PP3 Blocks and re-orientation.** 243 distinct limit blocks on five local days;
  session window 5h00m; the lag from a block to "continue" is 57 min minimum, 212
  median [10-token-meter.md; 11 §heuristics]. Two confirmed re-orientation episodes
  after a block (JSONL archaeology for verify lanes killed mid-flight; five scripts
  re-read) [11 §Confirmed]. Redo-after-compaction: documented null (0/16).
- **PP4 Building on an unread or stale mechanism.** One confirmed episode (an Airtable
  write after the Turso flip; stopped by the classifier) [11 §Confirmed]; the 08-12
  trio in CLAUDE.md; today: 3 of S1's brief claims wrong on contact, 2 already in fleet
  memory and not in the brief; 16 of 40 lever claims in the first survey refuted on
  the docs [13-research.md §Corrections]; 27 of 31 census nominations refuted on read.
- **PP5 Model and effort are not dials.** 97% of requests at `xhigh` (main 35,615 of
  36,697; subagent 39,023 of 40,255) [`--by lane,effort`]. Main lane: Opus 28.3M out
  over 30,147 requests, Fable 5/5.1 10.2M; `workflow-subagent` Opus 12.8M; `general-
  purpose` Sonnet 4.0M (4,346 req) vs Opus 3.2M (5,135 req) [`--by agent,model`]. 81
  manual `/model` switches in the corpus: `opus[1m]` 41, `claude-fable-5[1m]` 26,
  `claude-fable-5-1[1m]` 12, `sonnet` 1, `default` 1 — three of the four refuted
  `same-turn-many-sessions` nominations were these switches typed into every open
  session [11 §Confirmed].
- **PP6 Startup cost is the plugin/skill layer, not CLAUDE.md.** Main first call ≈53k
  frontier; repo CLAUDE.md ≤ ~5k tokens of it; 121 skills exposed (7 personal + 114
  plugin) and 3 MCP servers' tool definitions are the candidates [12 §What is
  configured to load]. 807 of the 30-day transcript files are Claude Code 2.0.77 with
  no entrypoint: `claude-mem`'s observer sessions (Haiku, cheap per call). Measured
  today: `claude-mem`'s hooks (Setup, SessionStart, UserPromptSubmit, PostToolUse:*,
  PreToolUse:Read, Stop) each fail with "Bun not found" — 216 hook errors in this
  session's transcript, 88 transcript files carry the string — and each hook first runs
  `$SHELL -lc 'echo $PATH'` (a login shell) per tool call; its MCP tools were called 3
  times in 30 days. `context-mode` (2,171 calls, heavily used) injects ≈35KB (~9k
  tokens) at SessionStart, on startup AND on every compaction. `claude-session-driver`
  hooks every PreToolUse/UserPromptSubmit/Stop/SessionStart/SessionEnd to emit events for
  a tmux worker-driver (`csd`) with no recorded use. `superpowers` injects its
  using-superpowers text on startup|clear|compact. `episodic-memory`: 121 calls,
  background sync only. [this session's attachment tally; plugin `hooks.json` files]
- **PP7 Instrument-blind waste (the repo's signature failure).** Green checks that
  cannot fail: #782 (`Analytics soft-fail at` field absent, digest signal can never
  fire), S5's `total=0` hole and release-health's unset-output guard (#780), the
  2026-08-12 trio. No detector in the census can see this class [11 §cannot see].
- **PP8 Operator attention.** Six decisions collected today that only the operator can
  make; 81 model switches; four sessions resumed one by one after a crash [11].
- **PP9 Off-laptop (#776).** The 08-24 overload and a "computer crashed because I also
  opened steam, resume" typed into four sessions [11 §Confirmed / refuted 27].
  Remote Control keeps files local and moves the UI; web sessions and routines run in
  the cloud with no local files [13 §Off the laptop].

## 2. Candidates

Format: mechanism · pain addressed · proof plan (PASS control and FAIL control) ·
effort · what would make it a mistake · provisional score (which priorities it serves).

### C1. Remove or repair the broken hook layer (`claude-mem`)

- Mechanism: disable `claude-mem@thedotmack` in `~/.claude/settings.json`
  `enabledPlugins` (operator applies), or install Bun if the memory it keeps is wanted.
- Pain: PP6 (a login shell + a failing hook on every tool call, six hook events), PP7
  (an instrument that has only ever failed, running on every call).
- Proof: FAIL control = a scratch session with three tool calls today shows three
  `hook_non_blocking_error: … Bun not found` attachments in its transcript. PASS = the
  same three calls after the change show zero. Both read from the transcript file, not
  from the UI.
- Effort: 5 minutes. Reversible.
- Mistake if: the operator relies on `claude-mem` recall (3 tool calls in 30 days say
  no; ask once).
- Serves: 1, 3, 6.

### C2. Cap fan-out concurrency where every session inherits it

- Mechanism: `"env": {"CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY": "4"}` in
  `~/.claude/settings.json` (operator applies); Workflow scripts keep an explicit
  `CHUNK` of 4 (today's refuter round: 31 candidates, four at a time, 7m54s wall).
- Pain: PP2 (the 08-24 overload was six parallel agents on a shared machine; #776).
- Proof: FAIL control = with the var unset, dispatch 8 trivial Haiku agents that each
  print `date +%s`, sleep 20 s, print again; ≥5 overlapping intervals. PASS = with the
  var set to 4, ≤4 overlap. Run when no other agents are live, or the count is
  confounded.
- Effort: 10 minutes plus the experiment.
- Mistake if: the cap that binds is not this one (the experiment decides); or Lane-1
  rounds become too slow (7.9 min for 31 says no).
- Serves: 1 (no overload), 3, 4.

### C3. Fan-out only through resumable harnesses; stop runbook verified once

- Mechanism: bare `Agent` fan-out (many background agents from one message) is
  replaced by `Workflow`, whose `journal.jsonl` and `resumeFromRunId` survive a
  session-limit block (the 2026-09-02 archaeology was for verify lanes killed
  mid-flight with no journal). Verify once, in a scratch session with two background
  agents: `TaskStop` on one stops exactly one; `Ctrl+X Ctrl+K` twice within 3 s stops
  the rest; record which chord works and put ONE line in global CLAUDE.md.
- Pain: PP2, PP3.
- Proof: PASS = `/tasks` shows one stopped after `TaskStop`, none after the chord;
  FAIL control = the chord the community reports (`Ctrl+F` twice) does nothing.
- Effort: 30 minutes.
- Mistake if: Workflow's own concurrency (min(16, CPUs−2)) ignores C2's cap — check
  in the same experiment.
- Serves: 1, 4.

### C4. Workers write to files; the controller reads the artifact

- Mechanism: the worker-brief template (already used for S2–S7 today) requires:
  memory grep before code; read the implementation of any flag or mechanism built on;
  corrections recorded, never improvised around; results returned as a path plus a
  ≤15-line summary; the controller reads the artifact and never trusts a reported
  number. Ship the template as `docs/superpowers/templates/worker-brief.md` and
  reference it from CLAUDE.md in one line.
- Pain: PP4 (2 of 8 workers today rediscovered facts in memory; S1's brief carried
  refuted claims), PP1 (main-lane growth from pasted results).
- Proof: PASS = a worker dispatched with the template cites the memory file for a fact
  it did not re-derive (S3's worker did, after the step was added). FAIL control = the
  same task briefed without the step re-derives it (S1's sharp worker did, 169k
  tokens). Both already observed today; record them as the controls.
- Effort: an hour to write; zero to run.
- Mistake if: it becomes a ritual paragraph nobody reads — keep it under 20 lines.
- Serves: 1, 3, 5.

### C5. A standing refuter round for any evidence package, plan or brief above ~10 claims

- Mechanism: generalise today's `census-refute.workflow.js` into a saved workflow
  `refute-claims` (`.claude/workflows/`, tracked): one skeptic per claim, default
  refuted, evidence read from disk, then a completeness critic; killed claims kept
  with the reason. Run it on every `docs/meta-week/`-style package and every plan
  before execution.
- Pain: PP4, PP7. Today: 16/40 lever claims refuted, 27/31 census nominations, 3/3
  S1 claims wrong on contact — every package so far has failed on first refutation.
- Proof: PASS = the round on the levers survey found the hook-contract error the docs
  confirm; FAIL control = the round on a package with a seeded false claim ("the
  session limit window is 4h") kills it.
- Effort: two hours (the script exists).
- Mistake if: it is run on prose without evidence on disk — the skeptics then refute
  from priors, which is worse than no round.
- Serves: 1, 3, 5.

### C6. A session line: context fill, 5-hour and weekly use, in the statusline

- Mechanism: a statusline command (`~/.claude/statusline.sh`, operator applies)
  that prints `context_window.used_percentage`, `rate_limits` (5h and 7d) and the
  session model/effort. Step one is to dump the raw JSON once and read it, before a
  single conditional is written against a field name.
- Pain: PP3 (a fan-out launched at 95% of the 5h window is the killed-verify-lanes
  episode), PP1 (nobody sees 374k per call until the meter is run).
- Proof: PASS = the line shows a number that matches `/usage`; FAIL control = a field
  the docs name that the payload lacks is reported as absent, not as 0.
- Effort: 30 minutes.
- Mistake if: it is built on percent-of-context whose base at 1M is unknown — show the
  raw token count next to the percent.
- Serves: 3, 4, 5.

### C7. Per-stage model and effort in workflows; Opus stays the worker default

- Mechanism: keep "Fable judges, Opus workers"; in Workflow scripts set
  `effort: "medium"` and `model: "sonnet"` for mechanical stages (window rendering,
  measurement, formatting) and leave judge/refute/review stages on Opus at session
  effort. Do NOT set `CLAUDE_CODE_SUBAGENT_MODEL` globally: on the 2.1.92 CLI it
  outranks per-call `model`, and it never touches Explore/Plan.
- Pain: PP5 (97% xhigh; workflow-subagent 28.4% of output on Opus).
- Proof: A/B on the next refuter round: 6 candidates judged by Opus/xhigh and by
  Sonnet/medium; PASS = verdicts agree on ≥5/6 and reasons cite the same lines; FAIL
  control = a deliberately hard candidate (the vida episode, where the anchor was
  wrong) — if Sonnet confirms on the cited prompt, it stays Opus-only.
- Effort: one round.
- Mistake if: correctness is traded for tokens on judgement stages — priority 1 beats
  5; mechanical stages only.
- Serves: 5, 6; guarded for 1.

### C8. Session per deliverable, as a measured A/B, not a rule

- Mechanism: for one week, `/clear` at each deliverable seam (after the PR merges and
  the journal line is written) instead of `/compact`; the journal, memory and the
  worker briefs carry continuity. Measure with
  `token-meter.mjs --by session,repo` and `--compactions`: per-request cacheRead and
  compaction preTokens before/after.
- Pain: PP1 (282k/request; compaction at ≥462k; Fable 374k).
- Proof: PASS = main-lane cacheRead per request falls by more than the noise between
  two ordinary weeks (compare Aug 24–28 vs Sep 7–11 first to know the noise); FAIL
  control = a week where the operator does not change practice shows no fall.
- Effort: none to start; the meter exists.
- Mistake if: a seam is cut mid-task and state is lost — the rule is "after the
  journal line", never mid-deliverable. Cache-read's weight against the subscription
  limit is unknown; if it is small, this buys little on tokens and is kept only for
  quality.
- Serves: 5, possibly 1 (long-context adherence), guarded for 1.

### C9. Prune the plugin layer to what is used, then re-measure startup

- Mechanism: disable `claude-session-driver` (no use; hooks on every event) unless
  #776 adopts its tmux driver; keep `context-mode`, `episodic-memory`, `superpowers`,
  `superpowers-chrome`, `figma`; decide `superpowers-developing-for-claude-code` on
  use (skills only). Then re-run `token-meter.mjs --startup` on a fresh session.
- Pain: PP6 (the 53k opening; 36–43k per spawn; 84M across spawns).
- Proof: PASS = a scratch session's first-call cacheCreate drops by the disabled
  plugins' listing size; FAIL control = re-enabling restores it. Numbers from the
  transcript, not from `/context`.
- Effort: 15 minutes plus two scratch sessions.
- Mistake if: a hook was load-bearing for something unmeasured (session-driver's events
  feed nothing found on disk); or the skills listing is not where the cost is — the A/B
  says.
- Serves: 5, 6, 3.

### C10. Make the proof rule executable: PR bodies that touch gates carry PASS and FAIL

- Mechanism: a CI check in `reddoor-maintenance` (`.github/workflows/pr-proof.yml`)
  that fails when a PR touching `.github/workflows/**`, `src/audits/**` or
  `src/alerts/**` has a body without both a "PASS" and a "FAIL" control line. The
  house rule from CLAUDE.md, as a gate.
- Pain: PP7.
- Proof: PASS control = #780's body passes; FAIL control = a stub PR with a body that
  says only "tests green" fails. Then the check's own history is watched by C11.
- Effort: an hour.
- Mistake if: it blocks doc-only PRs — path-scope it; if it accepts the words without
  the evidence — it cannot read evidence; it enforces the habit, not the truth.
- Serves: 1, 3.

### C11. Monotone-gate audit: any check that has only ever passed or only ever failed is unproven

- Mechanism: a nightly job that reads the machine lines (`PROTECTION_AUDIT`,
  `FLEET_FORM_E2E`, `RELEASE_STATE`, `NPM_DRIFT`, `FLEET_WRITE_SUMMARY`, …) from the
  last N runs and lists every line whose verdict has never varied since introduction,
  as a cockpit "unproven instrument" chip.
- Pain: PP7 (#782, the 08-12 trio, S5) — the class no census heuristic can see.
- Proof: PASS control = the `Analytics soft-fail at` signal (never fired) is listed;
  FAIL control = `FLEET_FORM_E2E skipped=N` after #779 (varies) is not listed.
- Effort: a day (Lane 2 next week).
- Mistake if: a gate legitimately never fails (a hard invariant) and the chip nags —
  give it an ack with an expiry, like the Prismic drift ack.
- Serves: 1.

### C12. Per-project default model instead of 81 manual switches

- Mechanism: `"model": "claude-opus-5[1m]"` in the `.claude/settings.json` of the
  personal repos (`Broken`, `songbook`, …) where 41 of the switches went to Opus; keep
  the global default `claude-fable-5-1[1m]` for `reddoor-maintenance` judging
  sessions.
- Pain: PP8 / PP5.
- Proof: PASS = a new session in `Broken` starts on Opus with no `/model`; FAIL
  control = a repo without the key starts on the global default.
- Effort: one line per repo; needs the `.claude/` tracking decision (A9).
- Mistake if: the operator's switches were about the weekly reset, not the repo (26
  went to Fable after "we just got a reset") — then the default is per-week, and this
  does nothing.
- Serves: 3.

### C13. Global permission hygiene

- Mechanism: prune `~/.claude/settings.json` `permissions.allow` (1,020 entries, most
  from other clients' projects, including `Bash(git reset:*)`, `Bash(for f:*)`) to
  patterns, and the 43 `additionalDirectories`.
- Pain: correctness/safety (over-broad allows), not tokens (rules are not sent to the
  model).
- Proof: PASS = after pruning, a `git reset --hard` in a scratch repo asks; FAIL
  control = today it does not.
- Effort: 30 minutes of the operator's time.
- Mistake if: a needed allow is dropped and a routine prompts — reversible.
- Serves: 1.

### C14. Off-laptop, as a spike with a decision at the end (#776)

- Mechanism: (a) never run Chrome/Playwright locally while agents run — browser checks
  belong on Actions runners (they already are for form-e2e); (b) Remote Control for
  the UI so the laptop lid can close on a session that stays local; (c) a spike, not a
  build: a Linux box with the fleet cloned, `claude` under tmux, credentials via `op`,
  attached through Remote Control — write up cost and what breaks (Airtable/Turso
  creds, `gh` auth, the sandbox) before any purchase.
- Pain: PP9, PP2.
- Proof: for (a) PASS = a week with no local browser use while agents run and no
  overload; (c) is a report, not a proof.
- Effort: (a) one CLAUDE.md line; (b) minutes; (c) half a day.
- Mistake if: (c) is built before the credential story is written — the sandbox
  boundary and `~/.config/reddoor-maint` do not travel.
- Serves: 3, 4.

## 3. Not recommended, and why (kept for the record)

- **`--max-budget-usd` as a kill switch.** Print-mode only (checked on 2.1.92); no
  interactive fan-out inherits it.
- **`CLAUDE_CODE_SUBAGENT_MODEL` set globally.** Below 2.1.251 it overrides per-call
  `model` and frontmatter, so on the PATH CLI it would demote judges too; it never
  touches Explore/Plan; the per-stage form (C7) does the same job safely.
- **Aggressive auto-compaction (`CLAUDE_CODE_AUTO_COMPACT_WINDOW` ≈ 200–300k) as a
  rule.** The census found no confirmed redo after compaction (0/16), so the cost of
  the current manual practice is tokens only, and cache-read's weight against the
  limit is unknown. Mid-task compaction risks priority 1 for priority 5. Kept as an
  option if C8's A/B shows the token cost matters.
- **A CLAUDE.md diet for tokens.** The largest repo file is ~5k tokens of a 53k
  opening; the guidance value (200-line target) stands, the token case does not.
- **Rewriting Renovate `packageRules` or presets.** S7's rule; the mechanism behind
  the drought is inferred, not measured.
- **A `Stop`-hook completion gate.** The block cap is unconfirmed and a gate that
  cannot pass is the repo's own failure class; C10/C11 do the same job at the PR and
  audit layer where it can be proven.

## 4. Decisions only the operator can make (this document adds none; it collects)

1. Approve or reject the queued Reddoor report `recVCP3qWUi71B15H`.
2. Clear the four high vulns + LAHI's CMS check before 2026-10-05, or not.
3. Phase 6 ordering: a dated go on #646, before or after 10-05.
4. `unpend-branch` on reddoor-starter #97, or leave for S7's metric to observe.
5. GCP console Maps-key restrictions; validity checks in the GitHub UI.
6. MSOT ↔ Revogen shared recipient cell.
7. `.claude/` tracking policy (A9) — C4, C5 and C12 ship as tracked files only if yes.
8. Disable `claude-mem` (C1) and `claude-session-driver` (C9), or keep and repair.
9. The `~/.claude/settings.json` diffs (C2, C6, C13) — applied by the operator.

## 5. Verification still owed before anything ships (from 13-research.md)

- Which concurrency cap binds (C2's experiment). - `TaskStop` by id and the kill chord
  (C3). - Statusline payload field names (C6). - Workflow concurrency vs the env cap
  (C3). - Cache-read weight against the subscription limit: ask the operator to read
  `/usage` now and compare with the meter's week-to-date (out, cacheCreate, cacheRead)
  against the ceiling week — one data point that would settle whether C8 is a token
  lever or only a quality one.

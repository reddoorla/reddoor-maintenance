# inv-06 — Agent & automation tooling

Survey date: 2026-09-12. Read-only. Every number below names the command that
produced it; where a claim is inferred rather than measured, it says so.

**Scope caveat, stated first.** The session corpus
(`.../scratchpad/corpus/sessions.jsonl`) covers **2026-08-10 → 2026-09-12** —
34 days, not the "since 2026-07-30" the brief implies. `commits.jsonl` reaches
further back; sessions do not. Every usage figure here is a 34-day window.
A skill last used on 2026-08-05 reads as "never used" in that window, so I
cross-checked the zero-usage cases against the full raw transcript history in
`~/.claude/projects/` (3,581 `.jsonl` files) before calling anything unused.

---

## 1. The shape of the layer

There is **no project-level agent tooling at all**. This is the single most
surprising structural fact of the survey and it inverts the assumption in the
brief.

```
$ ls -la /Users/tuckerlemos/Documents/GitHub/reddoor-maintenance/.claude/
settings.json          5210B   Jun 24
settings.local.json   14200B   Sep  1
.cc-writes/            (empty)
worktrees/             (empty, created Sep 1)
```

No `skills/`, no `agents/`, no `commands/`, no `hooks/`. A fleet-wide search
confirms it is not hiding in a sibling repo:

```
$ find /Users/tuckerlemos/Documents/GitHub -maxdepth 4 -type d \
    \( -name commands -o -name agents -o -name hooks \) -path '*.claude*'
(no output)
```

And `.claude/` is gitignored (`.gitignore:14`), so `git ls-files .claude`
returns 0 files. The project's agent configuration is **one settings file,
untracked**. Contrast that with `CLAUDE.md`, which was deliberately moved _into_
version control in #699 (`50864ff`) — the reasoning that applied to CLAUDE.md
was never extended to the settings beside it.

The real tooling lives in three places instead:

| Layer                                           | Location                                            | Version-controlled?                 |
| ----------------------------------------------- | --------------------------------------------------- | ----------------------------------- |
| 7 personal skills                               | `~/.claude/skills/*` → symlinks                     | **yes** — `reddoorla/claude-skills` |
| 8 marketplace plugins (64 skills)               | `~/.claude/plugins/cache/`                          | vendored, pinned by SHA             |
| 11 repo scripts + 13 recipes + a 31-command CLI | `reddoor-maintenance/{scripts,src/recipes,src/cli}` | yes                                 |

### 1a. The skills repo is the one part of this that is properly engineered

`~/.claude/skills/` contains **symlinks only**, not copies:

```
$ ls -la ~/.claude/skills/
evening-review -> /Users/tuckerlemos/Documents/GitHub/claude-skills/skills/evening-review
figma-slices -> .../claude-skills/skills/figma-slices
markup-review -> ...
matching-a-page -> ...
new-site -> ...
rfp-analyze -> ...
svelte4-to-5-upgrade -> ...
```

Source of truth: `https://github.com/reddoorla/claude-skills`, clean tree, 12
commits, created **2026-09-08** (4 days ago). `install.sh` is idempotent and
_refuses_ to clobber a real directory — its header explains precisely why the
plugin/marketplace layout was rejected (it would namespace to `reddoor:<name>`
and install at a versioned cache path, breaking every hardcoded
`node ~/.claude/skills/<skill>/x.mjs` in a SKILL.md as well as
`beachfront-dentistry`'s `matching/gate.sh:31` and `census.sh:18`). That is a
real design decision, written down, with the failure mode named. It is the
healthiest thing in this dimension.

Because the repo is 4 days old, **git dates cannot measure skill staleness** —
every skill shows a 2026-09-08 "chore: import" commit. I used content tests
instead (§3).

---

## 2. Measured usage — and one instrument I had to fix first

### 2a. `slashCommands` in the corpus is empty for all 3,469 rows. It is right.

The corpus reports `slashCommands: []` for every session. Applying the repo's
own rule, I did not trust that. Two independent checks:

```
$ python3 ... prompts.jsonl        → prompts: 5692, starting with '/': 0
$ python3 ... '<command-name>'     → command-name blocks: 0
$ grep -rhao '<command-name>/[A-Za-z0-9_:-]*' ~/.claude/projects | sort | uniq -c
    291 /compact
     99 /model
      3 /extra-usage
      2 /update-config
```

Ground truth from the raw transcripts confirms the corpus: the **only** slash
commands ever used are Claude Code built-ins. There are no custom slash
commands anywhere on this machine, and none are invoked. Where `CLAUDE.md` and
`MEMORY.md` write `/new-site`, `/markup-review`, `/loop`, those resolve to
_skills_ (or a built-in), not commands. The three `superpowers` commands that
do exist are all tombstones:

```
$ grep -m1 -i description: ~/.claude/plugins/cache/.../superpowers/5.0.7/commands/*
  brainstorm.md:    "Deprecated - use the superpowers:brainstorming skill instead"
  execute-plan.md:  "Deprecated - use the superpowers:executing-plans skill instead"
  write-plan.md:    "Deprecated - use the superpowers:writing-plans skill instead"
```

Those three deprecation notices are still advertised in the skill roster of
every session on this machine.

### 2b. `skills` in the corpus is exact — but it measures only one of two doors

Summed skill counts across `sessions.jsonl` = **336**, which matches the `Skill`
tool total in `toolCounts` exactly (336), and matches a raw-transcript count of
`"name":"Skill","input":{"skill":"..."}` occurrences exactly (336). The
instrument is sound _for what it measures_: Skill-tool loads.

It badly understates skills that carry executable scripts, because those get
driven by Bash path instead:

```
$ grep -rhoa 'skills/matching-a-page/[A-Za-z0-9./_-]*' ~/.claude/projects | sort | uniq -c | sort -rn
    667 skills/matching-a-page/page-diff.mjs
    297 skills/matching-a-page/SKILL.md
    215 skills/matching-a-page/style-census.mjs
    104 skills/matching-a-page/lib/report.mjs
     92 skills/matching-a-page/lib/capture.mjs
     87 skills/matching-a-page/text-diff.mjs
$ grep -rhoa 'skills/markup-review/[A-Za-z0-9./_-]*' ... | sort | uniq -c | sort -rn
   1290 skills/markup-review/markup.mjs
    142 skills/markup-review/SKILL.md
$ grep -rhoa 'skills/new-site/...' → 415 skills/new-site/SKILL.md
```

Spread across transcript _files_ (one grep, all history):

```
matching-a-page      2467 refs across 97 transcripts
markup-review        1599 refs across 38
new-site              409 refs across 62
rfp-analyze           258 refs across 23
svelte4-to-5-upgrade   71 refs across 21
figma-slices           61 refs across 23
evening-review         28 refs across 17
```

**Caveat on that table.** I tried to date-bound it with
`find . -name '*.jsonl' -newermt '2026-08-10'` and it matched **3,581 of 3,581**
files — every transcript's mtime has been touched, so file mtime cannot
separate recent from historical use here. Those counts are therefore
all-history, not 34-day. The dating that _is_ trustworthy comes from
`prompts.jsonl`'s `day` field, which puts `matching-a-page` use at 2026-09-09
(`29-navy`) and `markup-review` at 2026-08-10 (`beachfront-dentistry`) — both
inside the window. For `svelte4-to-5-upgrade` and `rfp-analyze` the dated
prompt evidence is thin (1 and 9 mentions, mostly context-continuation
summaries and task notifications), which is what the §3 verdicts rest on.

`matching-a-page` records **0 Skill-tool loads in the window** yet is the most
exercised skill on the machine (2,467 path references across 97 transcripts).
It is invoked by reading `SKILL.md` and shelling its scripts — largely in
`29-navy` on 2026-09-09 (21 prompt mentions of the skill, 56 of `page-diff`,
53 of `match-harness`). **Any inventory that reads only the `skills` array will
declare the most-used tool dead.**

### 2c. Skill-tool loads, ranked (336 calls / 34 days)

```
 58  superpowers:brainstorming            17 days  08-10..09-12
 45  superpowers:writing-plans            12 days  08-10..09-08
 40  superpowers:subagent-driven-development 9 days 08-10..09-09
 37  artifact-design                       7 days  08-18..09-08
 31  figma:figma-design-to-code            6 days  08-11..09-02
 22  superpowers:test-driven-development   8 days  08-23..09-10
 19  evening-review                        5 days  08-23..09-02
 12  superpowers:systematic-debugging      8 days  08-16..09-10
 12  figma-slices                          3 days  08-11..09-02
 11  superpowers-chrome:browsing           2 days  08-17..08-24
 10  claude-api                            3 days
  8  new-site / 6 markup-review / 6 code-review / 5 finishing-a-development-branch
  4  executing-plans / 3 using-git-worktrees / 2 figma:figma-use
  1 each: verification-before-completion, run, workflow-authoring, design,
         artifact-capabilities
```

**23 distinct skills invoked out of 64 advertised.** Only **53 of 872
top-level sessions (6.1%)** load any skill at all.

### 2d. Skill use is wildly uneven across repos

```
caldea                       206 sessions →   2 skill loads
reddoor-website              123 sessions →  84
reddoor-maintenance          108 sessions →  26
Broken                        81 sessions →  70
scriptorium-setup             57 sessions →   5
vida-legacy-foundation        54 sessions →  15
the-bench                     49 sessions →   0
beachfront-dentistry          41 sessions →  33
```

`caldea` is the single largest project by session count and essentially never
touches the skill layer; `the-bench` never does. Whether that is a gap or
correct (different kind of work) is a judgement for the meta week, but the
disparity is not explained by session count.

### 2e. Subagents

```
1040  general-purpose
 249  superpowers:code-reviewer
  35  Explore
  20  episodic-memory:search-conversations
   3  one-off named agents ("Apply anatomy audit fixes", …)
   1  claude-code-guide
```

Only three agent _definitions_ are installed (`superpowers/code-reviewer.md`,
`episodic-memory/search-conversations.md`,
`superpowers-chrome/browser-user.md`). The dominant pattern by a factor of four
is an unspecialised `general-purpose` subagent given an ad-hoc prompt. There is
no Reddoor-authored agent at all — no fleet-triage agent, no site-onboard
agent, no journal-writer — despite `MEMORY.md` recording "default to
subagent-driven" as standing policy.

---

## 3. Per-skill verdicts

| Skill                  | Size                                   | Skill-tool | Script/path refs                | Verdict                                        |
| ---------------------- | -------------------------------------- | ---------- | ------------------------------- | ---------------------------------------------- |
| `matching-a-page`      | 629L / 41.7KB + `lib/`, `node_modules` | 0          | **2,467**                       | **solid, heavily used** — measurement gap only |
| `markup-review`        | 23L + `markup.mjs` (11.4KB)            | 6          | **1,599**                       | solid                                          |
| `new-site`             | 128L                                   | 8          | 415                             | solid                                          |
| `evening-review`       | 148L                                   | 19         | 26                              | solid                                          |
| `figma-slices`         | 104L                                   | 12         | 58                              | solid                                          |
| `rfp-analyze`          | 335L + scripts/templates/tests         | **0**      | 63 (mostly its own import work) | **partial — see below**                        |
| `svelte4-to-5-upgrade` | 283L / 17.8KB                          | **0**      | 68 (mostly its own import work) | **stale — no target left**                     |

### `svelte4-to-5-upgrade` has no remaining job in the fleet

Its own description scopes it to projects "still on Svelte 4 / Vite 5 /
Tailwind 3". Measured across every checkout:

```
$ (per-repo package.json scan of 41 checkouts)
  sites on svelte 5: 27 ; on svelte 4: 0
```

Zero targets. The skill also encodes a now-drifted pin — it targets
`svelte@^5.23.0` (SKILL.md:68) while `reddoor-starter` ships `svelte: ^5.55.10`,
`vite: ^8.0.14`, `tailwindcss: ^4.3.0`, `pnpm@11.11.0`. Its _shape_ (the
7-commit recipe, the top-12 gotchas) may still be worth keeping as reference,
but as an advertised, loadable skill it is 17.8KB of roster and disk with no
live target and zero invocations in 34 days.

### `rfp-analyze` is live but structurally odd

0 Skill-tool loads in the window, but it is the only skill whose _working
directory_ is a separate repo — and that repo is the one checkout on the
machine with **no `origin`**:

```
$ ./scripts/fleet-repos.sh --skipped
reddoor-mailer   ARCHIVED    tucksravin/reddoor-mailer
rfp-analyze      NO-REMOTE   -
the-pointe       ARCHIVED    reddoorla/the-pointe
```

The skill source is safely in `claude-skills`; the _estimates workspace_ it
generates is not backed up anywhere. Its most recent commit
(`3d03c00`) fixes exactly this class of problem — "the handbook path a
generated repo inherits was stale and machine-bound".

---

## 4. The plugin set — and the one thing that is genuinely broken

Eight plugins enabled (`~/.claude/settings.json → enabledPlugins`, all `true`).
Note `plugins/installed_plugins.json` carries its _own_ `enabledPlugins` block
listing only `context-mode` — the two disagree; `settings.json` is the one that
takes effect (all eight plugins' skills appear in the live roster). Harmless,
but it is a trap for anyone auditing from the wrong file.

| Plugin                                 | Version | Skills | Hooks installed                                                              | MCP calls / 34d |
| -------------------------------------- | ------- | ------ | ---------------------------------------------------------------------------- | --------------- |
| context-mode                           | 1.0.166 | 8      | PostToolUse, PreToolUse ×9, UserPromptSubmit, PreCompact, SessionStart, Stop | **4,006**       |
| superpowers-chrome                     | 3.0.2   | 1      | —                                                                            | **1,774**       |
| figma                                  | 2.2.108 | 14     | —                                                                            | 502             |
| episodic-memory                        | 1.0.15  | 1      | SessionStart                                                                 | 139             |
| superpowers                            | 5.0.7   | 14     | SessionStart                                                                 | n/a (skills)    |
| superpowers-developing-for-claude-code | 0.3.1   | 2      | —                                                                            | 0 skill loads   |
| claude-session-driver                  | 3.0.2   | 1      | PreToolUse(`*`), SessionStart, Stop, UserPromptSubmit, SessionEnd            | 0               |
| **claude-mem**                         | 13.5.5  | **16** | Setup, SessionStart, UserPromptSubmit, PostToolUse, PreToolUse, Stop         | **4**           |

### claude-mem has been dead since the day after it was installed

Installed 2026-06-10. Its own log, then verified independently:

```
[2026-09-12 10:35:54.498] [ERROR] Bun runtime not found — install from https://bun.sh …
  The worker daemon requires Bun because it uses bun:sqlite.
[2026-09-12 10:35:54.498] [ERROR] Failed to spawn worker daemon
[2026-09-12 10:35:54.498] [ERROR] Worker auto-start failed — MCP tools that require the
  worker (search, timeline, get_observations) will fail until the worker is running.
```

I did not take the log's word for it:

```
$ which bun          → bun not found  (exit 1)
$ ls ~/.bun/bin/bun  → No such file or directory
```

Extent:

```
$ grep -la 'Bun runtime not found' ~/.claude-mem/logs/*.log | wc -l   → 71
  ... of 73 daily logs. First: claude-mem-2026-06-11.log. Last: 2026-09-10.
$ grep -ha 'Bun runtime not found' ~/.claude-mem/logs/*.log | wc -l   → 282 occurrences
$ ls -la ~/.claude/plugins/data/claude-mem-thedotmack/                → empty
```

So: **71 of 73 days broken, from the day after install.** Its data directory has
never been written. It recorded 4 MCP calls in 34 days (all
`mcp-search__search`, which cannot have returned anything). Meanwhile it still
installs six hook events including `PreToolUse` and `PostToolUse` — a process
spawn on essentially every tool call — and contributes **16 skills / 3,943
bytes** to the roster of every request. It is pure cost.

Its 16 skills also duplicate things that work: `make-plan`/`do` against
`superpowers:writing-plans`/`executing-plans` (45 and 4 real uses),
`mem-search` against `episodic-memory:search` (139 real uses), `smart-explore`
against `context-mode:ctx_search` (133 real uses).

### Three plugins compete for the same hook surface

`context-mode`, `claude-mem` and `claude-session-driver` each register
`PreToolUse` + `SessionStart` + `Stop` + `UserPromptSubmit`; `claude-session-driver`
matches `*` on PreToolUse. Two of those three (claude-mem, claude-session-driver)
have **zero measured usage** — claude-session-driver logged no MCP calls and no
skill loads in 34 days. Only `context-mode` earns its hooks, and earns them
decisively (4,006 calls, `ctx_execute` alone 3,119).

Cached but not enabled: **two** context-mode versions (1.0.162 and 1.0.166) both
carrying `hooks/hooks.json`. Only 1.0.166 is installed; 1.0.162 is dead weight.

### The one user-level hook is context-mode's crash-mat

`~/.claude/hooks/context-mode-cache-heal.mjs` — a self-installed SessionStart
hook that works around upstream `anthropics/claude-code#46915` (auto-update
breaks `CLAUDE_PLUGIN_ROOT`). It is running and finding nothing wrong:

```
$ tail -1 ~/.claude/context-mode/heal-partial-install.log
{"ts":"2026-09-12T17:35:53.265Z","healed":[],"stillMissing":[],"skipped":"not-partial", …}
$ wc -l ~/.claude/context-mode/heal-partial-install.log   → 875
```

875 lines, all `"skipped":"not-partial"` in the tail. Benign, but it is
third-party code auto-deployed into the user's hook directory, outside any
repo, and nothing tracks it.

### Memory layers: five of them, overlapping

1. `~/.claude/CLAUDE.md` (1,239B) — global machine notes
2. `reddoor-maintenance/CLAUDE.md` (11,261B) — project rules, tracked since #699
3. `MEMORY.md` auto-memory (20,327B index + **119 files / 884KB**)
4. `docs/workJournal.md` — the durable narrative record
5. `episodic-memory` (139 calls, works) + `claude-mem` (broken) + `context-mode`
   session DBs (828 files under `~/.claude/context-mode/sessions/`)

The global CLAUDE.md opens by saying it is "kept deliberately short" because
"context loaded into every session on this machine is paid for on every request
whatever the task". That discipline was applied to the 1.2KB file and not to
the 20KB `MEMORY.md` sitting beside it — **16× larger than the file whose
header states the rule.**

Fixed per-request context, measured:

```
global CLAUDE.md      1,239 B
project CLAUDE.md    11,261 B
MEMORY.md            20,327 B
skill roster         18,452 B  (64 skills' description frontmatter, enabled versions only)
                     ───────
                     51,279 B  ≈ 12,800 tokens before a single word of the task
```

Roster cost by owner: figma 6,197B, claude-mem 3,943B, personal 2,899B,
context-mode 2,423B, superpowers 1,974B, rest <400B each. Of figma's 14 skills,
2 are ever used (`figma-design-to-code` ×31, `figma-use` ×2). Of claude-mem's
16, zero.

---

## 5. Repo scripts — `scripts/`

```
2026-06-23  09ce7ec7   52L  central-dep-blocker.mjs          LIVE  (imported by smoke-dist.mjs:46)
2026-06-23  09ce7ec7    7L  register-central-dep-blocker.mjs LIVE  (same)
2026-07-28  db52934c   25L  webflow-fixtures.mjs             ORPHAN — no caller anywhere
2026-07-31  205b6406  200L  verify-header-fidelity.mjs       ORPHAN — referenced only by its own plan doc
2026-07-31  205b6406   38L  build-header-plate.mjs           ORPHAN — same
2026-09-01  a352df96  423L  smoke-dist.mjs                   LIVE  (package.json:78 "test:dist")
2026-09-05  686b08d3  105L  fleet-repos.sh                   LIVE  (mandated by CLAUDE.md:79)
2026-09-08  bb531e81  146L  validate-checks.mts              LIVE  manual probe
2026-09-08  bb531e81  263L  gen-report-fixture.mts           LIVE  manual probe
2026-09-08  bb531e81  365L  replay-checks.mts                LIVE  manual probe
2026-09-10  9fe4c7e8  631L  gen-match-harness-template.mjs   LIVE  (tests/recipes/match-harness-generator.test.ts:15)
```

Orphan check was run with the `.claude-worktrees/` copy excluded, since that
worktree doubles every match:

```
$ grep -ran webflow-fixtures --include='*.{ts,mts,mjs,json,yml}' . \
    | grep -v node_modules | grep -v '/dist/' | grep -v '\.claude-worktrees' | grep -v '^./scripts/'
(no output)
```

`build-header-plate.mjs` + `verify-header-fidelity.mjs` are the residue of the
header-image-generator work (`docs/superpowers/plans/2026-07-31-header-image-generator.md`,
`MEMORY.md` → #476). The plan itself annotates `build-header-plate.mjs` as
"one-time, offline … **Not shipped**" — so it is orphaned _by design_, but
nothing marks that in the file tree, and a future session grepping `scripts/`
has no way to tell an intentional one-shot from a regression. 290 lines across
three files with no caller and no note.

**No workflow calls any script:** `grep -ran 'scripts/' .github/workflows/*.yml`
returns nothing. Everything in `scripts/` is either hand-run or reached through
`package.json`.

### `fleet-repos.sh` — proven working, and a note on my own instrument

This is the script `CLAUDE.md` orders every session to run before a fleet
sweep, so it is worth proving rather than assuming. First attempt:

```
$ ./scripts/fleet-repos.sh --skipped 2>&1 | head -20; echo "EXIT=$?"
mktemp: mkdtemp failed on /var/folders/.../tmp.IBInAxThqP: Operation not permitted
EXIT=0
```

That `EXIT=0` is **`head`'s exit code, not the script's** — my probe was wrong,
not the script. Re-measured without the pipe:

```
$ ./scripts/fleet-repos.sh --skipped >out 2>err; echo "EXIT=$?"
EXIT=1
$ cat err
mktemp: mkdtemp failed … Operation not permitted
$ grep -n mktemp scripts/fleet-repos.sh
43:work=$(mktemp -d) || exit 1
```

The script fails loudly and correctly. Unsandboxed it produces exactly what
`CLAUDE.md` documents:

```
$ ./scripts/fleet-repos.sh --skipped
reddoor-mailer   ARCHIVED    tucksravin/reddoor-mailer
rfp-analyze      NO-REMOTE   -
the-pointe       ARCHIVED    reddoorla/the-pointe
REAL_EXIT=0
```

Instrument proven. The one real friction: under the project's own
`sandbox.enabled: true`, `$TMPDIR` is not writable, so the script cannot run at
all and an agent gets a cryptic `mkdtemp` error instead of the table. `git *`
and `gh *` are in `sandbox.excludedCommands`; `scripts/*.sh` is not.

---

## 6. Recipes and the CLI — the healthiest surface

`src/recipes/index.ts` registers **13** recipes: `sync-configs`, `bump-deps`,
`svelte-4-to-5`, `svelte-codemods`, `convert-to-pnpm`, `onboard`,
`a11y-fixtures-page`, `health-endpoint`, `smoke-suite`, `self-updating`,
`prismic-ci`, `match-harness`, `init`. The match-harness machinery is
`src/recipes/match-harness/{index,previous,template}.ts` plus the 631-line
generator `scripts/gen-match-harness-template.mjs`, which is covered by
`tests/recipes/match-harness-generator.test.ts`.

The CLI (`reddoor-maint` → `dist/cli/bin.js`) exposes 31 commands. Measured use
across all raw transcripts:

```
1155 match-harness   1151 audit      817 prismic-models   428 prismic-ci
 231 prospect-audit   216 prismic-seed 190 forms-notify-target 153 launch
 123 sync-configs     106 report      79 init   76 self-updating   68 upgrade
  60 header-image      55 list-audits 55 ensure-site  49 preflight
  43 list-recipes      43 bump-deps   42 convert-to-pnpm  40 svelte-codemods
  37 selftest          36 onboard     33 db
```

**Every one of the 31 command files is exercised.** The single file that never
appears — `src/cli/commands/prismic-models-report.ts` — is not a command at all
but a helper imported by `prismic-models.ts:95`. There is no dead CLI surface
here. This is the part of the agent-tooling layer that is genuinely in good
shape, and it is notable that it is the part with tests and a registry.

---

## 7. Worktree hygiene — four roots, two stale, one untracked

`CLAUDE.md` makes a worktree per branch mandatory in this repo. There is no
convention for _where_:

```
$ git worktree list
.../reddoor-maintenance                             9f5fc898 [main]
.../reddoor-maintenance-e2ebudget                   72c2f275 [fix/form-e2e-budget-attribution]
.../reddoor-maintenance-turso-spec                  4f5f1a14 [docs/airtable-to-turso-spec]
.../reddoor-maintenance/.claude-worktrees/meta-week 9f5fc898 [docs/meta-week-2026-09-12]
.../reddoor-maintenance/.worktrees/journal-fix      fcc72fe9 [docs/token-compare-correction]
```

Four roots: two sibling directories, `.claude-worktrees/`, `.worktrees/`, plus
an empty `.claude/worktrees/` created 2026-09-01 — a fifth that was started and
abandoned.

Staleness:

```
fix/form-e2e-budget-attribution   HEAD 2026-08-17   156 commits behind main   clean
docs/airtable-to-turso-spec       HEAD 2026-08-17   156 commits behind main   clean
docs/token-compare-correction     HEAD 2026-09-11     1 commit  behind main   clean
```

Two worktrees parked 156 commits back for 26 days. This is precisely the hazard
`MEMORY.md` records as "a stale worktree poisons archaeology" — a sibling
worktree on a superseded commit caused a _merged_ PR to be reported as
"unpushed". Both also sit outside the gitignored `.worktrees/` convention, so
`git status` gives no hint they exist; only `git worktree list` finds them.

And the ignore rule does not cover the harness's own default:

```
$ git check-ignore -v .claude-worktrees   → NOT IGNORED
$ git check-ignore -v .worktrees          → .gitignore:31 .worktrees/
$ git status --short
?? .claude-worktrees/
?? fmt.mjs
```

`.gitignore:27-31` explains the ignore of `.worktrees/` with: worktrees are
"permanent furniture — and while untracked it was the ONLY entry in
`git status`, which trains the eye to ignore a dirty tree." The `EnterWorktree`
tool writes to `.claude-worktrees/` instead, which reintroduces the exact
condition that comment was written to eliminate. `fmt.mjs` (1,173B, 2026-09-09,
a scratch prettier driver referencing `/tmp/body_`) is the second untracked
entry that the eye is now trained to skip past.

---

## 8. What a meta week should actually decide

1. **Delete or repair claude-mem.** 71/73 days broken, 0 working calls, 16
   roster skills, 6 hook events on every tool call. Repair means installing
   Bun; the evidence says nobody has missed it in three months.
2. **Disable `claude-session-driver`.** 0 measured use, `PreToolUse: *`.
3. **Retire `svelte4-to-5-upgrade` to reference docs.** 0 fleet targets.
4. **Decide whether `.claude/settings.json` joins CLAUDE.md in version
   control.** The argument that won for CLAUDE.md in #699 applies unchanged.
5. **Pick one worktree root**, gitignore it, and prune the two 156-commit-stale
   worktrees.
6. **Fix the usage instrument before any future audit** — the `skills` array
   misses script-driven skills entirely, which would have condemned
   `matching-a-page`, the most-used tool on the machine.
7. **Consider authoring one real agent.** 1,040 `general-purpose` dispatches
   against 3 installed agent definitions, none of them Reddoor's, is the
   clearest gap between stated policy ("default to subagent-driven") and what
   the tooling actually provides.

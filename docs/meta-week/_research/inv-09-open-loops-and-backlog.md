# inv-09 — Open loops and backlog

Survey date **2026-09-12**. Read-only. Every number below came from a command
run during this survey; where a conclusion is inferred rather than measured it
says so in the line itself.

Sources: the derived corpus at
`/private/tmp/claude-501/-Users-tuckerlemos-Documents-GitHub-reddoor-maintenance/28e83896-3f66-4bb2-86f0-612ee993fd98/scratchpad/corpus/`
(`prs.jsonl` 857 rows, `repos.jsonl` 41 rows, `sessions.jsonl` 3,469 rows,
`prompts.jsonl` 5,692 rows), plus live `gh` and `git` against the 41 checkouts in
`/Users/tuckerlemos/Documents/GitHub`.

---

## Headline

The fleet has **very few stuck things and one very fast-growing list**. Almost
every branch, worktree and PR that _looks_ abandoned turns out on inspection to
be either squash-merged, deliberately held by a rule, or a backup. The real open
loop is the **issue tracker**, which in the last two weeks began opening findings
about six times faster than it closes them, and a small number of genuinely
frozen items — one of them a security PR that Renovate has permanently stopped
maintaining.

| Loop                                                       | Count                                                                 | Where                                 |
| ---------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------- |
| Open PRs fleet-wide                                        | **32** (29 CLEAN, 3 BEHIND)                                           | 26 are one security wave              |
| Open issues fleet-wide                                     | **125** — 83 real + 42 Renovate dashboards                            | 58 real ones in `reddoor-maintenance` |
| Orphaned pre-App Dependency Dashboards                     | **17**                                                                | one per pre-August repo               |
| Remote branches                                            | **437** — 304 merged-but-undeleted, 62 never PR'd, 32 open, 11 closed |                                       |
| Local checkouts with a dirty tree                          | **7** of 41                                                           |                                       |
| Git worktrees beyond the primary                           | **18** across 7 repos; **3 prunable**                                 |                                       |
| `TODO`/`FIXME`/`HACK` markers in `reddoor-maintenance/src` | **0**                                                                 | see §7                                |

---

## 1. The backlog is accelerating — this is the finding that matters

```
$ gh issue list --repo reddoorla/reddoor-maintenance --state all --limit 1000 \
    --json number,createdAt,closedAt   # bucketed by ISO week
 week      opened closed  net
  2026-W32      5      3    +2
  2026-W33      3      2    +1
  2026-W34      7      7    +0
  2026-W35     11      5    +6
  2026-W36     24      4   +20
  2026-W37     35      6   +29     <- current week, still running
```

Through mid-August the central repo was at equilibrium (W34: 7 opened, 7 closed).
Since 2026-08-31 it has opened **59 issues and closed 10**. Today's 58 open
issues were _all_ created on or after 2026-08-03; the oldest non-dashboard one is
`#539` (2026-08-17, 26 days).

`gh issue list --repo reddoorla/reddoor-maintenance --state open --limit 500 --json createdAt --jq '.[].createdAt[0:7]' | sort | uniq -c`
→ `11 2026-08`, `47 2026-09`. **Forty-seven of the fifty-eight open issues were
filed in the last twelve days.**

**The character of the new issues explains the rate.** Reading titles: 12 of the
47 September issues are about the **match-harness** (`#772`, `#767`, `#763`,
`#760`, `#756`, `#753`, `#738`, `#736`, `#735`, `#734`, `#732`, plus
beachfront's nine and claude-skills' three), and another cluster is about the
**dev-route / gate-honesty** family (`#717` "54 of 55 /dev routes across the
fleet ship unguarded to production", `#727`, `#723`, `#719`, `#700`, `#680`).
These are not scattered bugs — they are two new subsystems being reviewed
adversarially and producing findings faster than anyone fixes them. `#711` names
the pattern in its own title: _"A derived or cached view read as the state
itself — five instances in one day."_

**Cost of leaving it:** the tracker stops being a work queue and becomes an
archive. It is already close: 58 items, no labels on 51 of them, no milestones,
no assignees. The meta-week's highest-leverage action on open loops is probably
a triage/cluster pass (the `oh-my-issues` skill exists for exactly this), not
fixing any individual item.

Fleet-wide the same shape holds but smaller: `beachfront-dentistry` has 9 open
(8 filed 2026-09-09, all match-harness), `vida-legacy-foundation` 6 (3 are a
"mutation audit" batch from 2026-09-05), `29-navy` 6, `reddoor-starter` 5.

---

## 2. Ranked open loops

Ranked by what it costs to leave alone, not by size.

### HIGH

**2.1 — `reddoor-maintenance#716` (vitest security) is permanently frozen, and a
documented fleet idiom froze it.** _Measured._

The Dependency Dashboard `#490` carries a section that exists nowhere else in
the fleet:

```
## PR Edited (Blocked)
The following updates have been manually edited so Renovate will no longer make changes.
 - [ ] <!-- rebase-branch=renovate/npm-vitest-vulnerability -->
       [chore(deps): update dependency vitest to v4.1.11 [security]](../pull/716)
```

The cause is visible in the branch:

```
$ gh api repos/reddoorla/reddoor-maintenance/compare/main...renovate/npm-vitest-vulnerability
ac389cc1 2026-09-11T15:20 reddoor-renovate[bot] | chore(deps): update dependency vitest to v4.1.11 [security]
b0383654 2026-09-11T19:45 Tucker Lemos       | Merge branch 'main' into renovate/npm-vitest-vulnerability
```

A human merge commit landed on a `renovate/*` branch. Renovate's
"manually edited" heuristic then stopped touching it, so it will sit `BEHIND`
forever — `compare` currently reports `ahead_by: 2, behind_by: 1` and `main`
takes 6–12 commits a day, so it can never become `CLEAN` on its own.

This is worth naming carefully because **two of the operator's own conventions
collide here**. The fleet-activity note says a `dirty` PR gets no `pull_request`
CI so you should _merge main in rather than rebase_; the 2026-08-12 note says
_never commit on a `renovate/*` branch_. Following the first on a Renovate
branch violates the second and permanently disables the bot for that update.
The recovery is one checkbox (`rebase-branch` on `#490`), but nothing surfaces
that — the PR looks green and ordinary from the outside.

**Cost:** a `[security]` update on the package every site consumes, stalled
indefinitely, with no alarm.

**2.2 — `reddoor-website`: `staging` is 15 commits ahead of `main`, with no
promote PR open.** _Measured._

```
$ git rev-list --count origin/main..origin/staging     # refs verified current
15
$ git ls-remote origin refs/heads/main      db6702f…  == local origin/main
$ git ls-remote origin refs/heads/staging   564376c…  == local origin/staging
```

The 15 include the entire **report edit-mode** feature (`#176`–`#181`,
"a private edit address, key exchanged for a cookie", "click any resolvable line
and rewrite it", "scrub the edit key from the address bar client-side too") and a
merged **vitest security** PR (`#171`). The last promotion was `#178`, merged
2026-09-10; everything since 2026-09-10 has accumulated on staging.

This has a second-order cost that is easy to miss. Renovate reads a repo's
config from the **default** branch:

```
$ git show origin/main:renovate.json      →  "baseBranches": ["staging"]
$ git show origin/staging:renovate.json   →  "baseBranchPatterns": ["staging"]
```

PR `#180` ("chore(renovate): use the current `baseBranchPatterns` key") landed on
staging on 2026-09-10 and cannot take effect until the promote happens — so
dashboard `#120` still shows **`## Config Migration Needed`**. _The fix for the
config warning is blocked behind the same promote it is supposed to unblock._

Note that issue `#623` — "Meta-work week: give Tucker sole authority to promote
staging → main" — is itself an open loop about this loop, filed 2026-08-26.

**Cost:** a shipped, proven feature (journal entry for `#766`: "an edit reaches
the live report and the PDF") is not on the production site, and a security merge
sits unreleased.

**2.3 — 26 `sharp` security PRs across 14 repos, held open by design.**
_Measured — and this is a rule working, not a rule broken._

All 26 are 2 days old (opened 2026-09-10), all `CLEAN`/`MERGEABLE`, all CI-green.
Before calling them stuck I named the rule that would have to permit the merge
and read it. `reddoorla/.github`'s `renovate-config.json` contains:

```json
{
  "description": "Never auto-merge packages that reshape the dependency graph …",
  "matchPackageNames": [
    "@reddoorla/maintenance",
    "sharp",
    "@zerodevx/svelte-img",
    "vite-imagetools",
    "imagetools-core",
    "@sveltejs/enhanced-img"
  ],
  "automerge": false,
  "platformAutomerge": false
}
```

`sharp` is named explicitly. These PRs are _supposed_ to wait for a human and a
green Netlify deploy preview. They are not frozen.

Two mechanical facts worth carrying into the review:

- **The pairs overlap.** Each repo gets two: `#54`-shaped ("update dependency
  sharp to v0.35.4", touches `pnpm-lock.yaml` only) and `#55`-shaped ("update
  dependency `sharp@<0.35.0` to `^0.35.4`", touches `pnpm-lock.yaml` _and_
  `pnpm-workspace.yaml`). `#55` subsumes `#54` — merging one leaves the other
  conflicting.
- **I expected `#55` to be the known override-KEY misread and it is not.** The
  brace-expansion/cookie advisory says never to merge a `pkg@<X to vY` Renovate
  PR because it misreads pnpm override _keys_. The actual diff on
  `alamo-anatomy#55` changes the **value** and preserves the key:
  ```diff
  -  "sharp@<0.35.0": "^0.35.3"
  +  "sharp@<0.35.0": "^0.35.4"
  ```
  That is correct. **Do not reject this wave on the strength of the title.**
  One real collateral loss: the same diff silently deletes the file's leading
  comment `# pnpm 11 reads settings from here (the package.json "pnpm" field is
no longer read).` — a comment that exists to stop an agent putting settings
  back in `package.json`.

Repos: alamo-anatomy 54/55, vineyard-custom-homes 62/63, beachfront-dentistry
44/45, reddoor-starter 118/119, caltex-landing 62/63, the-tower-burbank 19/20,
revogen 75/76, reddoor-starter-blux 9/10, gallerysonder 96/97,
medical-solutions-of-texas 63/64, 29-navy 2/3, vida-legacy-foundation 67/68,
canvas-starter 23 (single — no override key in its `pnpm-workspace.yaml`),
the-pointe-burbank 33 (single).

**Cost:** GHSA-f88m-g3jw-g9cj stays open across 14 sites for as long as nobody
sits down with the deploy previews. This is the largest single batch of human
work sitting in the fleet.

**2.4 — 4,962 unpushed lines in `welcome-to-the-flower-court`.** _Measured._

```
$ git -C welcome-to-the-flower-court rev-list --count origin/main..feat/sigil-badges
33
$ git -C welcome-to-the-flower-court diff --shortstat origin/main...feat/sigil-badges
 29 files changed, 4962 insertions(+), 21 deletions(-)
$ git -C welcome-to-the-flower-court ls-remote --heads origin feat/sigil-badges
(empty)
```

33 commits written 2026-09-06→09-07, on the repo's checked-out HEAD, **never
pushed to any remote**. Subjects include "the Doxe passes to Sophie Havranek; her
email sent and delivered", "Shey's address, one letter short; resent the
Prinxarch's email" — i.e. work with real-world side effects already taken.

Note the remote for this checkout is `tucksravin/invitations`, not a name matching
the directory — the mapping trap `CLAUDE.md` warns about.

**Cost:** one disk failure loses it all. This is the only place in the survey
where an open loop is also a data-loss exposure.

**2.5 — `CLAUDE.md` sends every session to a superseded branch.** _Measured._

`/Users/tuckerlemos/Documents/GitHub/reddoor-maintenance/CLAUDE.md:209`

> Design and plan are on branch `docs/airtable-to-turso-spec` under `docs/superpowers/`.

They are not, any more:

```
$ git ls-tree -r --name-only origin/main docs/superpowers/ | grep -a turso
docs/superpowers/plans/2026-08-17-airtable-to-turso-migration.md
docs/superpowers/specs/2026-08-17-airtable-to-turso-migration-design.md
$ git log --oneline --follow origin/main -- docs/superpowers/plans/2026-08-17-airtable-to-turso-migration.md | tail -1
efb73eb9 docs: put the #539 design and plan on main, and bring them current (#629)
```

And the branch version is materially _worse_ than main's:

```
$ git diff --stat origin/main:…plans/2026-08-17-airtable-to-turso-migration.md \
                  docs/airtable-to-turso-spec:…plans/2026-08-17-airtable-to-turso-migration.md
 1 file changed, 111 insertions(+), 175 deletions(-)
```

The branch is 175 lines _behind_ main's copy. A sibling worktree
(`/Users/tuckerlemos/Documents/GitHub/reddoor-maintenance-turso-spec`, parked at
`4f5f1a14`, 2026-08-17) keeps the stale copy permanently checked out on disk —
the exact "stale worktree poisons archaeology" hazard already in memory, here
reinforced by a `CLAUDE.md` line that _tells_ a session to go read the stale one.

The same paragraph also says the migration is "In flight … Scheduled for the
weekend of 2026-08-22", when the flip went live 2026-08-31 (`#643`) and `#539` is
still `OPEN`, last updated 2026-08-26.

**Cost:** `CLAUDE.md` is loaded into every session on this repo. A wrong pointer
there is paid for on every request, and it points at the _older_ of two
documents, which is the failure mode hardest to notice.

### MEDIUM

**2.6 — 50 Renovate branches created on Monday 2026-09-07 with no PR.**
_Measured; mechanism partly inferred — verify on Monday._

62 remote branches across the fleet have never had a PR of any state; **50 of
them are `renovate/*`, all with `committedDate` 2026-09-07**, which was a Monday
— the fleet's only Renovate window (`"schedule": ["before 6pm on monday"]`).
Spread across 21 repos. The commonest are `renovate/pnpm-12.x` (21 repos),
`renovate/major-vitest-monorepo` (8), `renovate/svelte-select-6.x` (6).

The dashboards list these same updates under **`## Awaiting Schedule`**, not
under `Open` or `Errored` — e.g. `alamo-anatomy#39`:

```
## Awaiting Schedule
 - [ ] renovate/all-minor-patch …
 - [ ] renovate/major-vitest-monorepo — chore(deps): update dependency vitest to v5
 - [ ] renovate/pnpm-12.x — chore(deps): update pnpm to v12
 - [ ] renovate/lock-file-maintenance
```

So Renovate's own view is "these are waiting for their window", which is benign.
**I could not prove why a branch exists at all for an out-of-window update**, and
I am not asserting a freeze. But the signature — a `renovate/*` branch with no PR
— is precisely what silently froze 9 repos during the App migration, where the
fix was deleting the branch (`#503`). **Concrete meta-week action: on Monday
2026-09-14, re-run the ref scan and check whether these 50 branches convert to
PRs. If they do not, they are frozen and the branches should be deleted.** The
scan is one command and the data is already in
`scratchpad/refs2.tsv`.

**2.7 — Genuinely never-PR'd branches with real content.** _Measured._

Of the 62 no-PR remote branches, 12 are not Renovate's:

```
2025-01-23  597d  gallerysonder             landing-placeholder
2025-02-13  576d  gallerysonder             with-intro
2025-09-11  366d  gallerysonder             revert-for-weekend
2025-09-16  361d  gallerysonder             stop-over
2026-04-30  135d  reddoor-md-pdf            feat/md-to-pdf-microapp
2026-05-07  128d  medical-solutions-of-texas svelte-5
2026-05-21  114d  reddoor-maintenance       feat/release
2026-05-21  114d  reddoor-maintenance       feat/trusted-publishing
2026-06-29   75d  reddoor-maintenance       feat/cockpit-accepted-watch-conditions
2026-07-15   59d  reddoor-starter           feat/portfolio-intro-slices
2026-08-17   26d  reddoor-maintenance       docs/airtable-to-turso-spec     (see 2.5)
2026-08-25   18d  reddoor-website           docs/prospect-report-route-plan (see 2.9)
```

Plus 7 whose only PR was **CLOSED** — work proposed and rejected, branch left
behind: `the-pointe/feat/design-pass-2-data-driven` (66d),
`reddoor-website/feat/medtech-industry-lp` (30d) and
`feat/medtech-process-section` (23d),
`beachfront-dentistry/feat/prismic-capped-image-widths` (11d),
`reddoor-starter-blux/maint/self-updating-20260901T060151241Z` (11d),
`reddoor-website/fix/phone-inventory-not-conflict` (11d),
`reddoor-maintenance/chore/ci-probe` (2d).

The remaining **304** remote branches are merged-PR leftovers. `delete_branch_on_merge`
is `true` on 25 of 28 org repos (`false` only on `29-navy`, `claude-skills`, and
the archived `the-pointe`), so these predate the setting. Harmless clutter, but
they are why a naive branch listing looks alarming.

**2.8 — A 847-line plan document stranded on an orphan branch.** _Measured._

`reddoor-website` branch `docs/prospect-report-route-plan`, 3 commits, never PR'd,
18 days old:

```
 docs/superpowers/plans/2026-08-25-prospect-report-route.md | 847 +++++++++++++
```

`docs/superpowers/plans/` exists on `staging` and holds its siblings
(`2026-09-03-report-narrative.md`, `2026-09-08-og-cards.md`) — this one specific
plan was left behind. The feature it plans (`/audit/[token]`) subsequently
shipped across ~15 PRs (`#139`–`#181`). So the design record for the largest
feature the marketing site built this quarter is reachable only from a branch
nothing links to.

**2.9 — Uncommitted working trees.** _Measured._ 7 of 41 checkouts:

```
$ for r in …; do git -C $r status --porcelain=v1; done
reddoor-mailer        1341   1340 tracked node_modules deletions + .DS_Store  (see 2.13)
a-budget                 3   M CLAUDE.md (+17/-1); ?? api/src/close-months.ts (98 lines),
                             ?? api/src/month-audit.ts (32 lines)  — written Sep 3, 9 days ago
revogen                  3   ?? src/lib/utils/reducedMotion.ts, ?? docs/morning-reports/,
                             ?? docs/code-review-2026-06-29.md
caldea                   1   M docs/workJournal.md  (+108 lines, uncommitted)
dont-lose-your-head      1   ?? build/   (build output, ignorable)
reddoor-maintenance      2   ?? .claude-worktrees/, ?? fmt.mjs
reddoor-rfp-analyses     1   ?? clients/2026-06/roalson/.rfp-analyze/crawl/ (4 files)
```

Two are real work, not noise. **`caldea` holds a complete 108-line work-journal
entry that was never committed** — the repo's last commit is dated today, so this
is a session that ended without writing its journal to disk, which is precisely
the failure the journal convention exists to prevent. **`a-budget`** has 130 lines
of new TypeScript (`close-months.ts`, `month-audit.ts`) plus a CLAUDE.md edit
sitting untracked on branch `chore/work-journal` since 2026-09-03.

`fmt.mjs` untracked at the root of the main `reddoor-maintenance` checkout is the
same shape as the `e2eb.local.mts` incident recorded in the latest journal entry
(a probe script left in the tree that then fails `prettier --check`).

**2.10 — Worktrees: 18 beyond the primary, 3 prunable, 6 sitting on
already-merged branches.** _Measured._

```
reddoor-website   7  .worktrees/{edit-mode,medtech-process,model-denominator,
                     overrides,red-band,report-control,report-design}
reddoor-maintenance 4  …-e2ebudget, …-turso-spec (siblings, outside the repo dir),
                       .claude-worktrees/meta-week, .worktrees/journal-fix
reddoor-starter   2  .worktrees/{pnpm-security,reply-copy}
the-pointe        2  both PRUNABLE → /private/tmp/claude-501/…/pointe-cms, …/pointe-wt2
1836dig           1  PRUNABLE → /private/tmp/claude-501/…/wt-1836dig-smoke
gallerysonder     1  .worktrees/rsvp-cta-guard
reddoor-starter-blux 1  .worktrees/reply-copy
```

Six of the seven `reddoor-website` worktrees are parked on branches whose PRs
**merged** (`#132`, `#142`, `#143`, `#144`, `#145`, `#177`) — see §7 for why they
still read as "unmerged". `medtech-process` is 91 commits behind `origin/main` and
its PR `#132` was _closed_, not merged. The three prunable entries point at
scratchpad directories that no longer exist.

**2.11 — 17 orphaned pre-App Dependency Dashboards.** _Measured._

Every repo that existed before the Renovate GitHub-App migration carries two open
`Dependency Dashboard` issues: the live one authored by `reddoor-renovate[bot]`
(created 2026-08-01…08-03) and a dead one authored by `tucksravin` (the old
self-hosted identity). 42 dashboards total, 17 of them orphaned:

```
1836dig#3, alamo-anatomy#3, caltex-landing#15, canvas-starter#3, data-dynamiq#4,
erp-industrial#36, espada#9, hedloc#8, la-homelessness-initiative#2,
la-homelessness-youth#1, medical-solutions-of-texas#17, reddoor-starter#16,
reddoor-website#9, revogen#15, the-pointe#9, the-pointe-burbank#3,
vineyard-custom-homes#17
```

They are stale snapshots nothing will ever update, and they inflate every
per-repo open-issue count by one. `the-pointe#9` cannot be closed at all — that
repo is archived.

**2.12 — Two Renovate health warnings nobody is watching.** _Measured._

- `revogen` dashboard `#53` carries `## Repository Problems` →
  `⚠️ WARN: Package lookup failures`. Some of revogen's dependencies are not
  being checked for updates _at all_, silently.
- `erp-industrial` dashboard `#41` carries `## Deprecations / Replacements` →
  `@prismicio/helpers` deprecated, `Replacement PR: Unavailable`. No automatic
  path off it.
- `reddoor-maintenance#490` also carries `## PR Closed (Blocked)` for
  `mjml to v5 [security]` (PR `#489`, closed 2026-08-03). **This one is a
  deliberate hold** — the mjml `mj-include` traversal is recorded as unreachable
  and not to be re-flagged until mjml 5 is stable. Do not "fix" it. Its rationale
  lives in agent memory and the journal, not in the repo, which is why it will
  keep being re-raised.

**2.13 — `reddoor-mailer`: 1,340 tracked `node_modules` files, on an archived
repo, with an unpushable branch.** _Measured._

```
$ git -C reddoor-mailer ls-files node_modules | wc -l
1340
$ git -C reddoor-mailer status --porcelain | grep -cv node_modules
1        # just .DS_Store
```

The 1,341 "dirty files" are one modified `.DS_Store` plus 1,340 committed
`node_modules` files that have been deleted from disk. The checkout sits on
`chore/work-journal`, 2 commits ahead, never pushed — and `reddoor-mailer` is
**archived on GitHub**, so those commits can never be pushed. This is the trap
`CLAUDE.md` documents: from inside the clone, `git remote -v`, `git ls-remote`
and `git fetch` all behave normally. Same situation, smaller, in `the-pointe`
(archived, `chore/work-journal` 2 ahead, unpushed) and `rfp-analyze` (no `origin`
at all, `chore/work-journal` checked out).

**2.14 — `beachfront-dentistry` is parked on an unpushed branch that is its
HEAD.** _Measured — and de-escalated on inspection._

```
$ git -C beachfront-dentistry log --format='%h %ad %s' --date=iso origin/main..fix/p751-unanchored-score
69430d8 2026-09-10 09:18:45 -0700 matching: an empty matrix is not a scorable page either (#751)
b53d1bc 2026-09-09 23:09:44 -0700 matching: next.mjs refuses to score a page with no anchors (#751)
$ git -C beachfront-dentistry diff --stat origin/main...fix/p751-unanchored-score
 docs/workJournal.md  |  60 ++++++++
 matching/harness.mjs |  54 +++++-
 matching/next.mjs    | 101 ++++++++++---
```

My first read was "central issue `#751` was closed COMPLETED at 2026-09-10T17:27Z
while the fix sits unpushed" — a false completion. That is **wrong**: the fix
_did_ land centrally as `9fe4c7e8 fix(match-harness): refuse to score a page that
cannot carry a score (#751) (#759)`. What is genuinely stranded is the **60-line
work-journal entry**, and the fact that the repo's checked-out HEAD is a
non-`main` branch with unpushed commits — the next agent session there starts in
the collision state `CLAUDE.md` warns about.

The same applies to `vida-legacy-foundation` (HEAD `fix/person-card-clipping`,
which _does_ have open PR `#74`) and `gallerysonder` (HEAD
`docs/journal-2026-09-11`, open PR `#99`). Nine of 41 checkouts are sitting on a
non-default branch.

### LOW

**2.15 — `dont-lose-your-head#62` — the one genuinely long-open PR.** _Measured._
Created **and last updated** 2026-08-23. Twenty days, zero comments, zero pushes,
`+370/-2`, "Touch controls: a drag stick that appears wherever the finger lands".
The repo's last Claude session was also 2026-08-23 (94 sessions total, all in a
two-day burst 2026-08-21→23). The whole project stopped mid-PR. It is a personal
game, so the cost of leaving it is only the cost of re-learning it later — but it
is the only PR in the fleet older than three days that is not part of a batch.

**2.16 — `reddoor-maintenance-e2ebudget`: a 26-day-old `wip` commit in a sibling
worktree.** _Measured._ `72c2f275 2026-08-17 wip(form-e2e): measure the POST span
separately for the budget check`, 42 insertions in `src/audits/form-e2e.ts`, never
pushed, no PR. The diff is substantial and carries its own reasoning in comments —
it separates `postElapsedMs` (the span `INGEST_TIMEOUT_MS` actually governs) from
`elapsedMs` (click→banner), citing "2026-08-17 vineyard-custom-homes warned at
16.9s click→banner while its own function answered in 0.25s warm / 2.0s cold".
`#641` shipped a _different_ form-e2e fix in the meantime. Either this idea is
still wanted, in which case it needs a PR, or it is dead and the worktree should
go; right now it is a third thing — a considered fix that nobody decided about.

**2.17 — `29-navy` is a new site with launch-blocking issues open.** _Measured._
Five non-dashboard issues, four filed today: `#31` "Prismic publishes never reach
the live site — no Netlify build hook exists", `#32` "/contact is live, unlinked,
and accepts submissions into central ingest", `#33` "Staging URL is fully
indexable, and the sitemap points at netlify.app", `#8` "Floor-plan PDFs: all four
404 on the live site". Its two `sharp` PRs are the fleet's only `BEHIND` ones
besides `#716` (`ahead_by: 1, behind_by: 2`) and need `gh pr update-branch`. This
is ordinary launch work, listed so the meta-week does not mistake it for debt.

**2.18 — `reddoor-maintenance#771` (`chore(release): version packages`).**
_Measured._ Open since 2026-09-11T20:02, `+43/-42`, one pending changeset on main
(`.changeset/a11y-summary-counts-the-routes-that-ran.md`). Per the merge-authority
policy, the version-packages PR is deliberately a human decision. Releases are
healthy — `chore(release)` commits on 2026-09-10 (`#755`), plus `#722` and `#708`
before it. Not a loop; noted so it is not counted as one.

---

## 3. Full open-PR inventory (32)

```
age  repo                        #    author                mergeState  title
 20  dont-lose-your-head         62   tucksravin            UNKNOWN     Touch controls: a drag stick…
  3  reddoor-maintenance        716   app/reddoor-renovate  BEHIND      vitest v4.1.11 [security]   ← FROZEN, §2.1
  2  alamo-anatomy               54/55 app/reddoor-renovate CLEAN       sharp                        ┐
  2  vineyard-custom-homes       62/63 app/reddoor-renovate CLEAN       sharp                        │
  2  beachfront-dentistry        44/45 app/reddoor-renovate CLEAN       sharp                        │
  2  reddoor-starter           118/119 app/reddoor-renovate CLEAN       sharp                        │
  2  caltex-landing              62/63 app/reddoor-renovate CLEAN       sharp / imagetools-core>sharp│
  2  the-tower-burbank           19/20 app/reddoor-renovate CLEAN       sharp                        │ 26 PRs
  2  canvas-starter                 23 app/reddoor-renovate CLEAN       sharp                        │ 14 repos
  2  revogen                     75/76 app/reddoor-renovate CLEAN       sharp                        │ §2.3
  2  reddoor-starter-blux         9/10 app/reddoor-renovate CLEAN       sharp                        │
  2  gallerysonder               96/97 app/reddoor-renovate CLEAN       sharp                        │
  2  the-pointe-burbank             33 app/reddoor-renovate CLEAN       sharp                        │
  2  medical-solutions-of-texas  63/64 app/reddoor-renovate CLEAN       sharp                        │
  2  29-navy                       2/3 app/reddoor-renovate BEHIND      sharp                        │
  2  vida-legacy-foundation      67/68 app/reddoor-renovate CLEAN       sharp                        ┘
  1  gallerysonder                  99 tucksravin           CLEAN       docs(journal) 2026-09-11
  1  reddoor-maintenance           769 tucksravin           UNKNOWN     docs: correct the token-compare entry
  1  reddoor-maintenance           771 app/reddoor-renovate CLEAN       chore(release): version packages
  0  vida-legacy-foundation         74 tucksravin           CLEAN       fix: person card clipping
```

No open PR anywhere has a **failing** check. Every `statusCheckRollup` entry
across all 32 is `SUCCESS` or `NEUTRAL`. Nothing in the open-PR set is blocked by
red CI.

---

## 4. Local branch inventory

41 checkouts hold **171 local branches**, 130 of them not `main`/`master`
(`sum(len(r['branches'])) over repos.jsonl`). The naive reading — "how many are not
merged into `origin/main`?" — produces ~40 false positives (§7). Cross-referenced
against `prs.jsonl`, the genuinely unlanded local branches with content are:

| repo                        | branch                                                                                                   | ahead  | last       | remote? | PR           |
| --------------------------- | -------------------------------------------------------------------------------------------------------- | ------ | ---------- | ------- | ------------ |
| welcome-to-the-flower-court | `feat/sigil-badges`                                                                                      | 33     | 2026-09-07 | no      | none         |
| reddoor-starter             | `backup/pipeline-premerge-087c76f`                                                                       | 78     | 2026-07-23 | no      | none         |
| reddoor-maintenance         | `backup/emit-prerebase-ac2a90f`                                                                          | 51     | 2026-07-23 | no      | none         |
| reddoor-maintenance         | `fix/blux-migrate-clean-repo-retry`                                                                      | 50     | 2026-07-23 | no      | none         |
| reddoor-maintenance         | `fix/blux-migrate-depalette-png`                                                                         | 49     | 2026-07-22 | no      | none         |
| data-dynamiq                | `feat/forms-dashboard-ingest`                                                                            | 6      | 2026-06-15 | no      | none         |
| the-pointe                  | `feat/design-pass-2-data-driven`                                                                         | 5      | 2026-07-08 | yes     | closed       |
| reddoor-starter             | `feat/blux-product-detail`                                                                               | 4      | 2026-07-17 | no      | none         |
| revogen                     | `perf/remove-legacy-prismic-toolbar`                                                                     | 3      | 2026-06-30 | no      | none         |
| the-pointe                  | `feat/blux-container-background`                                                                         | 3      | 2026-07-15 | no      | none         |
| revogen                     | `fix/home-graft-lqip-blur`                                                                               | 2      | 2026-06-30 | no      | none         |
| the-pointe                  | `fix/blux-grid-row-gutter`                                                                               | 2      | 2026-07-15 | no      | none         |
| beachfront-dentistry        | `fix/p751-unanchored-score`                                                                              | 2      | 2026-09-10 | no      | none (§2.14) |
| reddoor-maintenance         | `fix/form-e2e-budget-attribution`                                                                        | 1      | 2026-08-17 | no      | none (§2.16) |
| data-dynamiq                | `perf/bestpractices-cookies`, `feat/turnstile-widget`, `fix/slider-title-clobber`, `ci/wire-smoke-tests` | 1 each | Jun–Jul    | no      | none         |
| la-homelessness-initiative  | `ci/wire-smoke-tests`                                                                                    | 1      | 2026-07-15 | no      | none         |
| the-pointe                  | `feat/prismic-capped-image-widths`                                                                       | 1      | 2026-09-01 | no      | closed       |
| dont-lose-your-head         | `tucker/polish-intro-transitions`                                                                        | 1      | 2026-08-22 | no      | none         |

The four `backup/*` and `*-migrate-*` branches with 49–78 commits ahead are
almost certainly pre-rebase safety copies from the Blux migration work (their
names say so), not abandoned features. `data-dynamiq` is the one site repo with a
genuine cluster of forgotten branches — five, all 2–3 months old, none pushed.

Nine checkouts have HEAD on a non-default branch: `a-budget`,
`beachfront-dentistry`, `gallerysonder`, `reddoor-mailer`, `reddoor-website`,
`rfp-analyze`, `the-pointe`, `vida-legacy-foundation`,
`welcome-to-the-flower-court`.

---

## 5. Issue inventory (125 open fleet-wide)

```
 58  reddoorla/reddoor-maintenance     (57 real + 1 dashboard)
  9  reddoorla/beachfront-dentistry    (8 real  + 1)
  6  reddoorla/vida-legacy-foundation  (5 real  + 1)
  6  reddoorla/29-navy                 (5 real  + 1)
  5  reddoorla/reddoor-starter         (3 real  + 2)
  3  reddoorla/claude-skills           (3 real  + 0)
  3  reddoorla/the-pointe-burbank      (1 real  + 2)
  3  reddoorla/data-dynamiq            (1 real  + 2)
  2  × 12 repos                        (0 real  + 2 dashboards each)
  1  × 6 repos                         (dashboard only)
```

Only **8 of the 57** open `reddoor-maintenance` issues carry a label
(`enhancement` ×7, `bug` ×2). None carry a milestone or assignee. Two are
auto-filed by `app/github-actions` (`#652` and `#754`, both "Fleet protection
coverage gap") — `#652` has 9 comments and has been open 11 days, `#754` 2
comments, 2 days. Duplicate auto-filed tracking issues for the same alarm is
itself a small loop.

Three issues are explicitly meta-week-shaped and should be read before planning:
`#623` ("Meta-work week: give Tucker sole authority to promote staging → main"),
`#545` ("Fleet: enforce feature → staging → main flow with branch protection"),
`#672` ("Dashboard rework: design the cockpit for three operators").

`#539` (Airtable → Turso) and `#646` (Phase 6: delete the Airtable layer) are the
largest parked decisions: `#539` is `OPEN` with 26 comments, last touched
2026-08-26, describing a migration that completed 2026-08-31.

---

## 6. In-code deferred work: there is none

```
$ grep -arnE '\b(TODO|FIXME|XXX|HACK)\b' src --include='*.ts' --include='*.js' \
    --include='*.mjs' --include='*.svelte' --include='*.md' | grep -av node_modules | wc -l
0
```

**Instrument proof** (required, since a check that only ever returns nothing is
indistinguishable from a broken check — and BSD `grep` on this machine goes
silently binary-blind on em-dash files, hence `-a` throughout):

```
$ find src -type f \( -name '*.ts' -o … \) | wc -l
379
$ grep -arnE '\b(TODO|FIXME|XXX|HACK|export)\b' src --include=… | wc -l
2175
```

Same pattern, same flags, same file set: 2,175 hits with `export` added, 0 with
the markers alone. The grep is not blind; the markers genuinely do not exist.

Widening to `src tests scripts recipes` yields **5** hits, all false — `recXXX`
and `appXXXXXXXXX` as Airtable record-id placeholders in
`src/reports/airtable/reports.ts:517`, `tests/webhook/resend-webhook.test.ts`,
`tests/cli/report-command.test.ts`, and a path elision in `tests/audits/a11y.test.ts`.

Across 22 site checkouts the same sweep of `src/` finds **7 markers total**, one
each in `reddoor-website`, `data-dynamiq`, `caltex-landing`,
`medical-solutions-of-texas`, `hedloc`, `vineyard-custom-homes`, `espada`.

**This is a real property of the system, not an absence of evidence.** Deferred
work in this fleet is externalised — into GitHub issues and into
`docs/workJournal.md` — and never left as a code comment. That is why §1 is the
whole story: the issue tracker _is_ the backlog, with no hidden second channel.

The journal confirms the discipline from the other side: 22 dated entries,
1,975 lines, and the most recent one ends with an explicit
`**Still open after this.**` paragraph naming four specific unresolved items
(an unrun Playwright address-bar test; three length-leaking token compares in
`src/forms/token.ts` and reddoor-website's `/api/meeting-outcome`; a
`handlerError` content-type mismatch; a rate limit keyed `aggregateBy: ["ip"]`
that is one shared bucket for every operator).

---

## 7. Instrument notes — three checks that lied, and how they were caught

Per this repo's own top rule, every claim above was made only after the
instrument producing it had been shown to pass on a known-good input. Three did
not survive that test:

**7.1 — `git merge-base --is-ancestor <branch> origin/main` is useless here.**
It reported `design/audit-report-visual` as UNMERGED. But:

```
$ git log origin/main --oneline --grep='rebuild the report on the site'
ca4d310 design(audit): rebuild the report on the site's own band rhythm (#142)
```

The PR squash-merged, so the branch tip is not an ancestor even though the
content is on `main`. Across `reddoor-website` alone this produces ~20 false
"abandoned branch" readings. **The working instrument is a join against
`prs.jsonl` on `(repo, head)`**, checking PR _state_, not commit ancestry. Every
branch table above is built that way.

**7.2 — "PR is BEHIND and old ⇒ stuck in a rebase race" was wrong.** My first
theory for `#716` was that `main`'s 6–12 commits/day beat Renovate's twice-daily
rebase under the ruleset's `strict_required_status_checks_policy: true`. That
ruleset setting is real —

```
$ gh api repos/reddoorla/reddoor-maintenance/rulesets/16762724
{"name":"Main Protection","rules":[…,{"type":"required_status_checks",
  "checks":["build"],"strict":true}]}
```

— but it is not the cause. Reading the dashboard body (`## PR Edited (Blocked)`)
and then the branch's commit list gave the actual answer: a human merge commit.
The difference matters, because the two diagnoses have completely different
fixes: "loosen strict / raise cron" versus "click one checkbox and never merge
into a `renovate/*` branch again".

Note also that `gh api repos/…/branches/main/protection` returns
**`404 Branch not protected`** on every fleet repo — protection lives in
_rulesets_, not classic branch protection. A check written against the classic
endpoint would report the entire fleet as unprotected.

**7.3 — "`sharp@<0.35.0 to ^0.35.4` is the known override-KEY misread" was
wrong.** The prior (brace-expansion, `cookie@<0.7.0 to v1`) made this look like a
never-merge PR. The diff disproved it — key preserved, value bumped. See §2.3.
Had I stopped at the title, the correct response would have been to reject 12
security PRs.

**Two collection caveats.** (a) `gh` in the sandbox intermittently fails with
`tls: failed to verify certificate: x509: OSStatus -26276`; the sweeps in §2.6,
§2.11 and §5 were re-run unsandboxed. The corpus's own `gh-errors.txt` shows the
same class of failure during its build (`connection reset by peer` on the GraphQL
endpoint and on `hedloc`'s runs), so **`prs.jsonl` and `runs.jsonl` may be
short** — every PR-state claim above was re-verified live against `gh`.
(b) A prompt-text scan for deferral language (`later|defer|park|next session|
for now|punt|backlog`) hit 502 of 5,692 prompts, concentrated in `Broken` (179)
and `reddoor-website` (81). The precision is too low to draw conclusions from and
nothing above rests on it.

---

## 8. If the meta-week only does five things

1. **Triage the 58 central issues into clusters** before any of them is fixed.
   Two clusters (match-harness, dev-route/gate honesty) account for roughly half.
   The `oh-my-issues` skill targets exactly this shape.
2. **Unfreeze `#716`** — tick `rebase-branch` on dashboard `#490`, then write down
   the rule collision (merge-main-in vs never-commit-on-`renovate/*`) somewhere a
   session will read it.
3. **Promote `reddoor-website` staging → main.** It releases a proven feature, a
   security merge, and the Renovate config migration in one move — and `#623`
   already exists to decide who is allowed to do it.
4. **Sit down once with the 26 `sharp` PRs and their Netlify previews.** Merge the
   `#55`-shaped one per repo (it subsumes the `#54`-shaped one), restore the
   `pnpm-workspace.yaml` header comment it deletes.
5. **Push `welcome-to-the-flower-court`**, and fix `CLAUDE.md:209` so it stops
   pointing at a 175-lines-stale copy of the Turso design.

On Monday 2026-09-14, re-run the ref scan and check whether the 50
`Awaiting Schedule` Renovate branches converted to PRs (§2.6). That is the one
finding in this survey with a pending measurement rather than a conclusion.

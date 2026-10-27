# inv-03 — Renovate & dependency automation

Survey date **2026-09-12** (Saturday). Evidence is from the pre-built corpus at
`/private/tmp/claude-501/-Users-tuckerlemos-Documents-GitHub-reddoor-maintenance/28e83896-3f66-4bb2-86f0-612ee993fd98/scratchpad/corpus/`
(window opens 2026-07-30) plus live read-only `gh` / `gh api graphql` calls made during the survey.
Nothing was modified, committed or pushed. Where a claim is inference rather than
observation it is labelled **INFERRED** inline.

---

## 0. The headline

**The routine dependency channel has shipped nothing for five consecutive Mondays.**

`group:allNonMajor` — the grouped non-major update that is the fleet's normal way of moving
`@reddoorla/maintenance`, `svelte`, `vite`, `@sveltejs/kit`, `eslint`, `node` and the rest — last
produced a pull request on **2026-08-10**. Since then, on 08-17, 08-24, 08-31 and 09-07, Renovate
ran on schedule, succeeded, **created and updated the branch**, and **opened no PR**. Right now
**23 of the 24 active fleet repos hold a `renovate/all-minor-patch` branch whose tip commit is dated
2026-09-07 and which has no pull request attached.**

Every existing instrument is green on this. The liveness probe asks "did the workflow run and
succeed?" (yes, 1626/1629 runs). The effectiveness probe asks "is Renovate refusing to touch a
branch?" (no, it touches it every Monday). Neither asks "did a PR ever come out the other end."
This is the repo's own CLAUDE.md failure shape — _an instrument green on a question it cannot fail_ —
one level up from the 2026-08-03 incident the detector in `src/audits/protection-coverage.ts:155-180`
was written for.

---

## 1. The configuration, as it actually is today

### 1.1 The shared preset is one file, and the local copy is the live one

- Preset: `/Users/tuckerlemos/Documents/GitHub/reddoorla-dot-github/renovate-config.json` (11 730 bytes).
- Every fleet repo's `renovate.json` is three lines: `{"$schema": …, "extends": ["github>reddoorla/.github:renovate-config"]}`.
  Verified byte-identical across 25 checkouts; the **only** per-repo deviation in the fleet is
  `reddoor-website/renovate.json`, which adds `"baseBranchPatterns": ["staging"]`.
- **Instrument check first.** The local `.github` checkout is 2 commits behind `origin/main`
  (local `25bab2c`, remote `c714d9e`), so I did not trust it blind:

  ```
  $ gh api graphql -f query='{repository(owner:"reddoorla",name:".github"){object(expression:"main:renovate-config.json"){... on Blob{oid byteSize}}}}'
  {"data":{"repository":{"object":{"oid":"d0c6610675eb610970f2941e3d54c00dd9cb06c1","byteSize":11730}}}}
  $ git hash-object renovate-config.json
  d0c6610675eb610970f2941e3d54c00dd9cb06c1
  ```

  Same blob. The two commits the checkout is missing are CI fixes (Playwright apt/Chrome repo,
  `284616b`/`c714d9e`, 2026-09-09); the last change to the preset itself was **#29 `9b82c1d`,
  2026-08-12**. So everything below describes the configuration Renovate is running _right now_.

### 1.2 Global settings

| key                                              | value                                                                       | why it matters here                                         |
| ------------------------------------------------ | --------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `extends`                                        | `config:recommended`, `helpers:pinGitHubActionDigests`, `group:allNonMajor` | one branch per repo carries **every** non-major update      |
| `timezone`                                       | `Etc/UTC`                                                                   |                                                             |
| `schedule`                                       | `["before 6pm on monday"]`                                                  | Renovate may only create/rebase/merge inside this window    |
| `minimumReleaseAge`                              | `1 day`                                                                     | emits a `renovate/stability-days` commit status on branches |
| `internalChecksFilter`                           | `strict`                                                                    | pinned so the contract does not rest on an upstream default |
| `prCreation`                                     | `not-pending`                                                               | **added 2026-08-12 in #28 (`bcb9d5d`) — the pivot point**   |
| `lockFileMaintenance`                            | enabled, Monday, `automerge: true`, `platformAutomerge: false`              |                                                             |
| `osvVulnerabilityAlerts` / `vulnerabilityAlerts` | both on                                                                     |                                                             |

Cron: `.github/workflows/renovate.yml`, `0 */12 * * *` — twice daily. Renovate authenticates as the
`reddoor-renovate` GitHub App (app-id `4465971`, bot user id `312185038`), mints a repo-scoped token
via `actions/create-github-app-token`, and — deliberately — performs its **own** merges
(`platformAutomerge: false` everywhere). The repo cron _is_ the merge cadence.

### 1.3 The packageRules, in priority order of what they actually do

1. **`matchUpdateTypes: [patch, minor] → automerge: true, platformAutomerge: false`.** The workhorse.
   Renovate merges from inside its own run, so these rules — not a per-PR GitHub flag — are the
   decision-maker. Verified live: `alamo-anatomy#52` and `1836dig#17` (pnpm 11.11.0 security) both
   show `mergedBy: reddoor-renovate`, as does `reddoor-starter#105` (lock file maintenance).
2. **`matchUpdateTypes: [lockFileMaintenance] → minimumReleaseAge: null`.** Exempts whole-tree
   lockfile refreshes from the 1-day age gate (#27).
3. **Never auto-merge graph-reshaping packages:** `@reddoorla/maintenance`, `sharp`,
   `@zerodevx/svelte-img`, `vite-imagetools`, `imagetools-core`, `@sveltejs/enhanced-img`.
   Requires a human + a green Netlify deploy preview.
4. **`matchUpdateTypes: [major] → automerge: false`.**
5. **pnpm hold:** `matchDepNames: [pnpm]`, minor+patch, `enabled: false` — because
   `pnpm/action-setup`'s self-installer crashed on any pnpm ≥ 11.9 (2026-07). **Now stale, see §4.**
6. **`typescript` `allowedVersions: <7.0.0`** — typescript-eslint rejects TS 7.
7. **`@libsql/client` `allowedVersions: <0.9.0`** — `@libsql/kysely-libsql` hard-pins `^0.8.0`.
8. **`cookie` `allowedVersions: <2.0.0`** — cookie v2 drops the named exports `@sveltejs/kit` imports.
9. **pnpm-override hold:** `matchDepTypes: [overrides, pnpm.overrides, pnpm-workspace.overrides]`,
   `enabled: false` — Renovate reads override _keys_ (`sharp@<0.35.0`, `@sveltejs/kit>cookie`) as
   dependencies and proposes rewriting the pin itself.

The preset's `description` array is unusually good: it carries the 2026-08-12 self-correction
("16 of those 17 PRs were never automerge-eligible at all"), the `platformAutomerge` forensics, and
the falsified claim that pnpm's own `minimumReleaseAge` backed the lockfile exemption. Read it before
touching anything; it is the densest artefact in the whole fleet.

---

## 2. Volume, latency, and who actually merges

`prs.jsonl` was still filling during the survey; final snapshot **857 rows / 36 repos**.
Author `app/reddoor-renovate` covers **232** PRs — but **24 of those are Changesets "version
packages" PRs** on `changeset-release/main` (the release workflow mints the same App token).
**Corpus caveat: `author == app/reddoor-renovate` is not the same as "Renovate opened it."**
Filtering on `head != changeset-release/main` gives **208 genuine Renovate PRs**, 24 % of all fleet PR
traffic in the window.

```
FLEET Renovate: 208 PRs   merged=135  open=27  closed-unmerged=46 (22%)
time-to-merge (h): median 15.6   p25 12.3   p75 32.3   p90 66.1   max 76.0
```

Per repo (corpus snapshot; `medTTM` = median hours from createdAt to mergedAt):

```
repo                         PRs  mrg open  cls  medTTMh  maxTTMh
1836dig                        8    7    0    1     11.2     65.8
29-navy                        2    0    2    0      n/a      0.0
alamo-anatomy                 13    9    2    2     16.4     67.5
beachfront-dentistry          11    7    2    2     22.1     76.0
caltex-landing                10    5    2    3     15.8     67.0
canvas-starter                12    8    1    3     16.5     66.5
data-dynamiq                   8    6    0    2     15.6     66.0
erp-industrial                10    6    0    4     14.8     67.1
gallerysonder                 13    8    2    3     16.6     54.9
la-homelessness-initiative     8    5    0    3     14.9     66.4
la-homelessness-youth          7    6    0    1     13.1     67.1
medical-solutions-of-texas    11    7    2    2     14.3     66.1
reddoor-maintenance           13    9    1    3     15.9     68.0
reddoor-md-pdf                 2    2    0    0     13.4     14.2
reddoor-starter               10    6    2    2     17.3     67.1
reddoor-starter-blux           3    1    2    0     13.0     13.0
reddoor-website               11    8    0    3     14.9     66.1
reddoorla-dot-github           4    4    0    0     16.6     48.0
revogen                       13    8    2    3     24.5     66.6
the-pointe-burbank            11    8    1    2     15.9     66.1
the-tower-burbank             13    8    2    3     16.8     66.8
vida-legacy-foundation         3    1    2    0     14.4     14.4
vineyard-custom-homes         12    6    2    4     15.1     67.5
```

The ~15 h median is the cron beat, not human latency: a PR opened at 01:00 UTC Monday is merged by
the 13:00–17:00 UTC Monday run. The ~66 h tail is the **grouped** non-major PRs, which a human has to
merge (§5).

Creation is bursty and has become sparse (Renovate + changesets, per day):

```
2026-08-03 Mon  78 ##############################################################################
2026-08-10 Mon  60 ############################################################
2026-08-17 Mon   2 ##      <- both are changesets "version packages", NOT Renovate
2026-08-24 Mon   0
2026-08-31 Mon  16 ################   <- lock file maintenance only
2026-09-02 Wed  20 ####################   <- pnpm 11.11.0 [security]
2026-09-07 Mon   0
2026-09-09 Wed  32 ################################   <- sharp 0.35.4 [security]
```

**46 closed-without-merge.** 30 of them are the `cookie@<0.7.0 to v1/v2` override-key misreads of
2026-08-03/08-10, plus 4 `brace-expansion@…`/`file-type@…`/`@sveltejs/kit>cookie`. Rule 9 landed
2026-08-10 12:55 PT (`1645945`, .github#25) and **no non-security override-key PR has appeared since** —
that rule demonstrably works. The remaining closures are `typescript to v7` (5) and
`@sveltejs/vite-plugin-svelte`/`prettier-plugin-svelte` majors, all subsequently handled by
`allowedVersions` holds.

---

## 3. The stall — what is measured, and the mechanism

### 3.1 The cron is not the problem

`runs.jsonl` has **1629 renovate runs, 1626 success / 3 failure** across 23 repos (failures:
`la-homelessness-youth` 2026-08-05 and 2026-08-11, `reddoor-md-pdf` dispatch 2026-08-10 — all old).
Scheduled runs land ~44/day = 2 per repo per day.

Monday in-window check (window is "before 18:00 UTC Monday"):

```
2026-08-03: runs=29 in-window=29  repos=15  repos-with-in-window-run=15
2026-08-10: runs=32 in-window=32  repos=16  repos-with-in-window-run=16
2026-08-17: runs=34 in-window=34  repos=17  repos-with-in-window-run=17
2026-08-24: runs=36 in-window=36  repos=18  repos-with-in-window-run=18
2026-08-31: runs=36 in-window=18  repos=18  repos-with-in-window-run=18
2026-09-07: runs=42 in-window=42  repos=21  repos-with-in-window-run=21
```

Every repo got at least one in-window Monday run on every Monday. **The window is not the blocker**,
though the margin is thin: GitHub delays scheduled workflows by 1–7 hours, and on 2026-08-31 the
second Monday slot for all 18 repos slipped to 18:27–19:04 UTC — _outside_ the window. On 2026-09-07
it came in at 17:39 UTC, twenty minutes from the cliff.

### 3.2 Renovate builds the branch and then stops

`gh run view 34074662218 --repo reddoorla/reddoor-starter --log` (Monday 2026-09-07, 01:57 UTC):

```
INFO: Repository started (repository=reddoorla/reddoor-starter)
INFO: Dependency extraction complete
INFO: Branch updated  (branch=renovate/all-minor-patch)
INFO: Branch created  (branch=renovate/major-vitest-monorepo)
INFO: Branch created  (branch=renovate/pnpm-12.x)
INFO: Branch created  (branch=renovate/lock-file-maintenance)
INFO: Repository finished
```

Four branches, **zero PRs**. The second in-window run the same Monday
(`34145227692`, 16:53 UTC) did a full extraction and then `Repository finished` with no branch or PR
line at all.

### 3.3 Fleet-wide: 23 of 24 repos are holding a stalled group branch

One GraphQL query over all `refs/heads/renovate/*` in the org (`checkSuites` totals come back as 3
because GitHub instantiates empty suites for the repo's workflow apps; the REST `check-runs`
`total_count` for the same SHA is **0**):

```
repos with a renovate/all-minor-patch branch: 23   of which with NO pull request: 23
all 23 branch heads dated: 2026-09-07
every one carries exactly one status context: renovate/stability-days = SUCCESS
```

Also sitting PR-less on 2026-09-07 heads: `renovate/lock-file-maintenance` in **22** repos (zero
statuses), `renovate/pnpm-12.x` in **20**, `renovate/major-vitest-monorepo` in 7, plus
`svelte-select-6.x`, `prismicio-svelte-2.x`, `slice-machine-ui-2.x`, `svelte-gestures-5.x`,
`major-font-awesome`, `resend-6.x`, `mjml-5.x`, `listr2-11.x`, `google-auth-library-11.x`,
`changesets-cli-3.x`, `changesets-action-2.x`, `cac-7.x`, `node-24.x`, `actions-setup-node-7.x`,
`major-puppeteer`. Roughly **90 branches** across the fleet with no PR.

### 3.4 There is work waiting, so this is not "nothing to update"

26 live Dependency Dashboards (updated 2026-09-12 14:28–15:26 UTC by that morning's run) list
**“Awaiting Schedule”** items. Example — `reddoorla/reddoor-starter#97`:

```
## Awaiting Schedule
 - [ ] fix(deps): update all non-major dependencies (@lucide/svelte, @playwright/test,
       @reddoorla/maintenance, eslint, globals, node, reddoorla/.github,
       renovatebot/github-action, svelte, typescript-eslint, vite)
 - [ ] chore(deps): update dependency vitest to v5
 - [ ] chore(deps): update pnpm to v12
 - [ ] chore(deps): lock file maintenance
## Open
 - [ ] sharp to v0.35.4 [security]  (../pull/118)
 - [ ] sharp@<0.35.0 to ^0.35.4 [security]  (../pull/119)
```

Group sizes range from 5 (`reddoor-md-pdf`) to 16 (`reddoor-maintenance`); `beachfront-dentistry`
is carrying 14 packages in one branch. `reddoorla/.github`'s own group (`pnpm/action-setup`,
`renovatebot/github-action`) is stalled too — **the preset repo cannot update the Renovate action
that runs the preset.**

### 3.5 Why no PR — the mechanism

Measured facts that constrain the explanation:

1. `prCreation: not-pending` landed **2026-08-12** (#28). The last grouped PR was **2026-08-10**.
   Nothing else in the preset changed after that date.
2. The grouped branch head has **one** status, `renovate/stability-days` = SUCCESS
   (`created_at == updated_at == 2026-09-07T01:58:35Z`, description
   _"Updates have met minimum release age requirement"_). So the age gate was **not** pending, and
   `internalChecksFilter: strict` cannot be the blocker.
3. The same head has **zero check runs**:
   `gh api repos/reddoorla/reddoor-starter/commits/263b6cd…/check-runs` → `{"total_count": 0}`.
4. **No fleet repo runs CI on a `renovate/*` push.** All 23 site repos:
   `on: pull_request` + `push: branches: [main, staging]`. `reddoor-maintenance/.github/workflows/ci.yml`
   adds exactly one bot branch — `changeset-release/main` — and its comment explains why
   (a push event dodges the manual-approval gate that leaves bot-opened `pull_request` runs in
   `action_required`). The same trick has never been extended to `renovate/*`.
5. The `renovate/lock-file-maintenance` branch, which carries **no** `renovate/stability-days` status
   (rule 2 sets `minimumReleaseAge: null`), also has zero statuses/checks — and _did_ get a PR on
   2026-08-31, one week after its branch was created, with **no** "Branch updated" line in the
   08-31 log (i.e. the branch content was a week old):
   ```
   2026-08-31T02:27:05  INFO: Branch updated (branch=renovate/all-minor-patch)     <- no PR
   2026-08-31T02:27:09  INFO: PR created     (branch=renovate/lock-file-maintenance)
   ```

**INFERRED mechanism** (consistent with all five, not directly logged): `prCreation: not-pending`
resolves the branch status while treating Renovate's own internal checks as _not_ success
(`internalChecksAsSuccess` defaults to `false`), so a branch whose only status is
`renovate/stability-days` reads as **pending** forever. Renovate's escape hatch is
`prNotPendingHours` (default 25): once a branch has sat that long it opens the PR anyway — but the
grouped branch is **rebased every Monday** ("Branch updated"), which resets the clock, and the Monday
window is at most ~18 h wide, so 25 h never elapses in-window. The lockfile branch escapes only in
the weeks when its regenerated content is unchanged and the branch survives a week untouched — which
predicts **lock file maintenance runs every other week, not weekly**, exactly the observed
08-03 / 08-10 / (gap) / 08-31 / (gap) pattern.

Security PRs are unaffected because Renovate's `vulnerabilityAlerts` defaults include
`prCreation: immediate` — which is why the only Renovate PRs to open since 08-12 are `[security]`
ones and the twice-lucky lockfile wave.

**Cheapest way to settle the inference (one Monday, one repo, prove-the-instrument style):** pick one
site repo as the control and add `renovate/**` to its `ci.yml` push branches. If the grouped PR opens
on 2026-09-14 in that repo and nowhere else, the missing-check-runs theory is confirmed and the fix
is a one-line change to the reusable workflow's callers. A second, non-destructive probe is a
`workflow_dispatch` of `renovate.yml` with `LOG_LEVEL=debug`, which prints the `prBlockedBy` reason
verbatim.

### 3.6 What the stall costs, in versions

`@reddoorla/maintenance` published **0.95.1** (`CHANGELOG.md:3`, central `package.json` version).
Fleet manifests read from each repo's default branch (`HEAD:package.json` via GraphQL, so not a
stale-checkout artefact):

```
^0.93.1  29-navy, reddoor-starter, reddoor-starter-blux
^0.93.0  gallerysonder
^0.90.1  revogen, vida-legacy-foundation
^0.90.0  alamo-anatomy, beachfront-dentistry, caltex-landing, canvas-starter, erp-industrial,
         hedloc, the-pointe-burbank, the-tower-burbank, vineyard-custom-homes
^0.83.0  espada, medical-solutions-of-texas, reddoor-website
^0.81.0  1836dig, data-dynamiq, la-homelessness-initiative, la-homelessness-youth
^0.80.0  composition-hospitality
^0.75.0  the-pointe (ARCHIVED)
```

These are `^0.x` ranges, so npm caret semantics **lock the minor**: `^0.81.0` resolves only inside
`0.81.x`. Nothing but a manifest bump — i.e. the grouped PR — can move them. Four sites are 14 minors
behind the plumbing package the fleet is built on; nine are 5 behind.

Manual escape hatch that already exists: `src/recipes/bump-deps.ts`
(`reddoor-maint recipe bump-deps --group minor|major`), a pnpm-outdated/`pnpm up` recipe with a
clean-tree precondition.

---

## 4. Security updates bypass the `enabled: false` holds — twice proven

Rules 5 and 9 use `enabled: false`. Vulnerability alerts ignore it.

**pnpm.** Rule 5 holds pnpm minor+patch at 11.8.x. On **2026-09-02** a `[security]` wave bumped pnpm
**11.8.0 → 11.11.0 in 20 repos in 3 hours**, and `reddoor-renovate` auto-merged them itself
(`alamo-anatomy#52`, `1836dig#17`: `mergedBy: reddoor-renovate`). The fleet's default branches now all
read `"packageManager": "pnpm@11.11.0"` — except the two archived repos, `the-pointe` and `the-tower`,
still on `pnpm@11.8.0`, which is a neat confirmation of the archived-repo rule in CLAUDE.md.

The hold's stated cause no longer binds: `pnpm/action-setup@0977fd9 # v6.0.10` with no `version:`
input reads `packageManager` and CI has been green on 11.11.0 since — e.g. `reddoor-starter#118`
(2026-09-09) shows `ci / ci SUCCESS`. **Rule 5 is now a stale hold**: it holds nothing the fleet has
not already passed, and its own comment says "Remove when action-setup/corepack reliably installs
pnpm ≥11.9."

**Overrides.** Rule 9 disables override-key bumps. It works for routine updates — 34 such PRs were
closed unmerged on 08-03/08-10 and **zero** have opened since. But on **2026-09-09** twelve
`sharp@<0.35.0 to ^0.35.4 [security]` PRs opened anyway, one per repo that pins sharp in
`pnpm-workspace.yaml`. `gh pr view 119 --repo reddoorla/reddoor-starter --json files` confirms they
touch `pnpm-workspace.yaml` _and_ `pnpm-lock.yaml`:

```
-  sharp@<0.35.0: ^0.35.3
+  sharp@<0.35.0: ^0.35.4
```

This particular wave is **benign** — a bump inside the same caret major, not the range-widening shape
that made `cookie@<0.7.0 → v1` dangerous. But the bypass is real and the preset does not say so for
rule 9 (it does for rule 5). The next security advisory on an override key could arrive as a
major-widening rewrite with automerge enabled and nothing in the config to stop it.

---

## 5. The `@reddoorla/maintenance` hold: still true, and what it costs

**Still true.** The rule is present verbatim in the live preset (blob `d0c6610…`), and
`@reddoorla/maintenance` appears in the `all non-major` group of **24 of the 26 live dashboards** —
every site repo. Under `group:allNonMajor` one held package makes the whole grouped branch
non-automergeable, so the grouped PR always needs a human plus a green Netlify preview.

**Cost, measured on the last wave that actually happened (2026-08-10, 17 grouped PRs):**
median time-to-merge **66–67 h**, max **76 h**, `nReviews: 0` on every one, and
`mergedBy: tucksravin` — e.g. `reddoor-starter#100` created 2026-08-10T01:04Z, merged
2026-08-12T20:12Z by `tucksravin`. Contrast the same week's automergeable traffic: lockfile and
security PRs merged by `reddoor-renovate` in 13–16 h. So the hold buys ~50 h of latency and one
manual action per repo per wave — **and delivers nothing in return**, because the human-review step
it exists to force is not happening (0 reviews on 30/30 grouped PRs in the window; the merge is a
click).

**Cost right now: zero**, because no grouped PR exists to be held. The binding constraint has moved
upstream. That is worth stating plainly so the meta-week does not spend its effort on rule 3 while
the real blockage is §3.

**The rule is, however, live and biting on the security path.** `sharp` and `imagetools-core` are in
the same never-automerge list, which is why the 2026-09-09 advisory wave is still open:

```
open bot PRs org-wide (live GraphQL, 2026-09-12): 34
 - 31 sharp/imagetools-core [security], 17 repos, age 3.6–3.7 days,
   ALL mergeable=MERGEABLE mergeStateStatus=CLEAN statusCheckRollup=SUCCESS
 - composition-hospitality#18 concurrently→v10 (33.7 d) and #20 jsdom→v30 (33.2 d), CLEAN, SUCCESS
 - reddoor-maintenance#716 vitest 4.1.11 [security] — mergeStateStatus = BEHIND
 - reddoor-maintenance#771 changeset-release "version packages" (human-merge by policy)
```

`reddoor-starter#118` checked individually: `CLEAN`, `MERGEABLE`, `autoMergeRequest: null`,
`reviewDecision: ""`, `ci / ci SUCCESS`, `ci / deploy-preview-comment SUCCESS`. This is the
"green + unmerged = a rule working" pattern the preset warns about — **but a rule working for
3.7 days on a critical libheif RCE advisory (GHSA-rgj7-g3m4-5g8c, two CVSS-v3 Criticals) across
17 client sites is still an exposure the operator should see as a number.**

Two more costs in that wave worth naming:

- It is **two PRs per repo** (direct dep + override key) and both touch `pnpm-lock.yaml`, so merging
  one makes the other `dirty` — and a `dirty` PR gets no `pull_request` CI run.
- `reddoor-maintenance#716` is `BEHIND`, not blocked by a rule: `main` there is a strict branch and
  moves constantly (10 `version packages` merges in 11 days). Renovate has not rebased it in 3.7 days.

---

## 6. What the fleet's own instruments can and cannot see

`src/audits/protection-coverage.ts` is genuinely well built and its comments name the exact incident
it was written for. It has three Renovate surfaces:

| function                           | question it asks                                                                                                       | verdict today                                                                        |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `renovateGaps` (`:133`)            | workflow present, active, succeeded within `RENOVATE_STALE_AFTER_DAYS = 3`?                                            | **green** (1626/1629 runs succeeded; 2/day)                                          |
| `renovateBlockedGaps` (`:181`)     | any branch in the dashboard's _"PR Edited (Blocked)"_ section, orphaned by machine authorship or `BLOCKED_STALE_DAYS`? | **green** (branches are current and Renovate-authored)                               |
| `dashboardVocabularyGaps` (`:206`) | any dashboard heading outside `KNOWN_DASHBOARD_SECTIONS`?                                                              | **green** — and `"awaiting schedule"` is _in_ the known set (`src/github/gh.ts:190`) |

The parsed dashboard type is `{ present, blockedBranches, unknownSections }` (`src/github/gh.ts:171`).
**Nothing reads the "Awaiting Schedule" section, nothing counts PR-less `renovate/*` branches, and
nothing measures the age of the newest merged Renovate PR per repo.** All three green verdicts are
literally correct and jointly useless here — the 2026-08-03 detector was built for _"Renovate refuses
to touch the branch"_, and the 2026-09 failure is _"Renovate touches the branch every week and never
opens a PR."_ Same symptom (`renovate/all-minor-patch` frozen, `@reddoorla/maintenance`,
`@sveltejs/kit`, `vite`, `@playwright/test`, `node` all stuck behind it), different cause, invisible
to the instrument.

The outcome-based check that would have caught both, and is one field away from the existing parser:
**"days since this repo last MERGED a non-security Renovate PR"**, or equivalently **"count of
`renovate/*` branches with no associated PR whose tip is older than 8 days."**

---

## 7. Housekeeping observed along the way

- **18 orphaned Dependency Dashboards** are still open — one per repo from before the App migration,
  last updated 2026-07-27 → 2026-08-12, listing obsolete work (`typescript to v7`,
  `cookie@<0.7.0 to v2`). Search finds 44 dashboards for ~26 live repos. Noise on every
  `is:issue is:open` sweep, and a trap for any future dashboard-reading probe that does not pick the
  newest.
- **`reddoorla/the-tower` is archived** (`isArchived: true`, last push 2026-08-12) and still on
  `pnpm@11.8.0` / `@reddoorla/maintenance ^0.80.0` with a live dashboard. CLAUDE.md and
  `scripts/fleet-repos.sh` name `reddoor-mailer` and `the-pointe` as the archived pair; `the-tower`
  has no local checkout so the script cannot see it. **That makes three archived repos in the org,
  not two.**
- **`composition-hospitality`** is an active org repo (`@reddoorla/maintenance ^0.80.0`, dashboard
  `#15`, 4 open PRs) with **no local checkout** and no row in `repos.jsonl`. Any survey that
  enumerates `~/Documents/GitHub` misses it.
- `.github` repo's own renovate group is stalled like everything else, so `renovatebot/github-action`
  sits at v46.2.2 with v46.3.0 available. The Renovate _major_ the fleet runs is whatever the action
  bakes in — and `src/audits/protection-coverage.ts:206` already flags that a dashboard-heading
  rename would arrive via exactly that PR.
- Three historical renovate-workflow failures (`la-homelessness-youth` 08-05 and 08-11,
  `reddoor-md-pdf` dispatch 08-10); none recent, none currently red.

---

## 8. Meta-week shortlist, ordered by leverage

1. **Unblock PR creation.** Control experiment on one repo first (add `renovate/**` to `ci.yml` push
   branches, or dispatch with `LOG_LEVEL=debug` to read `prBlockedBy`), then pick one of:
   revert `prCreation` to `immediate` (restores 08-03/08-10 behaviour and the deadlock #28 was
   fixing), set `internalChecksAsSuccess: true`, or give `renovate/*` branches real CI so
   `not-pending` has something to resolve against. The third is the only option that makes the gate
   mean what it says.
2. **Add an outcome check** — days-since-last-merged-Renovate-PR, or PR-less `renovate/*` branch age —
   to `protection-coverage.ts`, and prove it FAILs on today's fleet _and_ PASSes against the
   2026-08-10 snapshot before trusting either verdict.
3. **Merge the sharp wave** (31 PRs, 17 repos, 3.7 days). Expect a rebase per repo because the two
   PRs collide in `pnpm-lock.yaml`.
4. **Delete stale rule 5** (the pnpm 11.8.x hold) — the fleet is on 11.11.0 with green CI; the hold
   now only suppresses the signal it was meant to preserve.
5. **Document the vulnerabilityAlerts bypass on rule 9**, as rule 5 already does, and decide whether
   a security override-key rewrite should be allowed to automerge.
6. **Reconsider `group:allNonMajor` + the `@reddoorla/maintenance` hold together.** Splitting
   `@reddoorla/maintenance` into its own branch would let the other ~10 packages automerge on the
   cron and leave one small human-merge PR per week — which is what the hold was always for.
7. **Close the 18 orphaned dashboards; add `the-tower` and `composition-hospitality` to the fleet
   inventory.**

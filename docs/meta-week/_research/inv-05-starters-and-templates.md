# inv-05 — Starters and templates

Survey date: 2026-09-12. Read-only. Every number below came from a command run
against the local checkouts, the GitHub API, or the pre-built corpus at
`/private/tmp/claude-501/.../scratchpad/corpus`; where I could not verify
something I say so.

Repos surveyed:

- `/Users/tuckerlemos/Documents/GitHub/reddoor-starter` (`reddoorla/reddoor-starter`)
- `/Users/tuckerlemos/Documents/GitHub/reddoor-starter-blux` (`reddoorla/reddoor-starter-blux`)
- `/Users/tuckerlemos/Documents/GitHub/canvas-starter` (`reddoorla/canvas-starter`)

---

## 1. The three repos as they stand today

|                                                     | reddoor-starter                           | reddoor-starter-blux           | canvas-starter                      |
| --------------------------------------------------- | ----------------------------------------- | ------------------------------ | ----------------------------------- |
| remote                                              | reddoorla/reddoor-starter                 | reddoorla/reddoor-starter-blux | reddoorla/canvas-starter            |
| `isTemplate` (gh)                                   | **true**                                  | **true**                       | **false**                           |
| visibility / archived                               | PUBLIC / no                               | PUBLIC / no                    | PUBLIC / no                         |
| local `main`                                        | `310df15` 2026-09-11                      | `6b032e8` 2026-09-05           | `8a3edb2` 2026-09-05                |
| local == `origin/main`                              | yes                                       | yes                            | yes                                 |
| total commits                                       | 288                                       | 279                            | 31                                  |
| root commit                                         | `bf9ead0` 2024-02-22 `initial`            | `bf9ead0` (same)               | `0432062` 2026-07-24 (**own root**) |
| tracked files                                       | 203                                       | 358                            | 238                                 |
| test files (`*.test/spec.ts`)                       | 49                                        | 98                             | 65                                  |
| slices                                              | 9                                         | 28 (11 `Blux*`)                | 15                                  |
| custom types                                        | 2 (`page`, `form_replies`)                | 8                              | 1 (`page`)                          |
| `pnpm verify` script                                | **yes**                                   | no                             | no                                  |
| `test:a11y` script                                  | **yes**                                   | no                             | no                                  |
| `.prettierrc.json`                                  | **yes**                                   | **no**                         | **no**                              |
| `package.json#reddoor.a11yRoutes`                   | `["/"]`                                   | **absent**                     | **absent**                          |
| `docs/STARTER.md` / `NEW-SITE.md` / `COMPONENTS.md` | y / y / y                                 | – / – / –                      | – / – / –                           |
| `docs/workJournal.md`                               | y                                         | y                              | y                                   |
| CI                                                  | `reddoorla/.github/ci.yml@8f9852c` v1.4.1 | same SHA                       | same SHA                            |
| `netlify-site:` input                               | `reddoor-wireframer`                      | `reddoor-starter-blux`         | `canvas-starter-591`                |
| local worktrees                                     | 3                                         | 2                              | 1                                   |

Verified with `gh repo view <slug> --json name,isTemplate,visibility,isArchived`,
`git -C <path> rev-list --count HEAD`, `git ls-files`, `git ls-tree -d main:src/lib/slices`,
and `git ls-remote origin refs/heads/main` against each local `main`.

CI health over the corpus window (2026-07-30 → 2026-09-12, `runs.jsonl`):

```
reddoor-starter      167 runs  166 success / 1 failure   (ci 76✓+1✗, renovate 90✓)
reddoor-starter-blux  44 runs   44 success / 0 failure   (ci 20✓,     renovate 24✓)
canvas-starter       139 runs  136 success / 3 failure   (ci 47✓+3✗,  renovate 89✓)
```

The one native failure was `feat/cms-reply-copy` on 2026-09-03 (a PR branch, since
merged as #112). Nothing is red on `main` anywhere.

---

## 2. The two-track model, stated precisely

`reddoor-starter` is the **native default**. `/new-site <slug>` (the skill at
`/Users/tuckerlemos/.claude/skills/new-site/SKILL.md`) runs
`gh repo create reddoorla/<slug> --public --template reddoorla/reddoor-starter`;
`--track blux` swaps the template to `reddoorla/reddoor-starter-blux`.

`reddoor-starter-blux` is a **full-history snapshot** of the native repo. That is
not a figure of speech — the two repos share every commit up to the split point,
and git agrees:

```
$ git -C reddoor-starter-blux merge-base main refs/remotes/starter/main
82d93b08aa1036af7ba95b16fff1ec5adbe14d04
$ git -C reddoor-starter log -1 --format='%h %ad %s' --date=short 82d93b0
82d93b0 2026-08-31 Merge pull request #103 from reddoorla/feat/testimonial-cta-banner
```

So the documented split point `82d93b0` is exactly the merge base of the two
`main` branches. The blux repo carries a `starter` remote
(`https://github.com/reddoorla/reddoor-starter.git`) for cherry-picking.

The native repo then shed the Blux layer in **`ac7660f` = reddoor-starter#106**,
`refactor(template): native-only starter — Blux track moved to reddoor-starter-blux`:

```
$ git diff --name-status ac7660f^ ac7660f | awk '{print $1}' | sort | uniq -c
   9 A
 178 D
  52 M
   3 R
$ git show --stat ac7660f | tail -1
 242 files changed, 1453 insertions(+), 29941 deletions(-)
```

136 of the 178 deleted paths match `blux` case-insensitively. Slice count went
28 → 9 and custom types 7 → 1 (the starter is back to 2 today because #112 added
`customtypes/form_replies`). Those are the same figures the starter's own journal
quotes, and they check out.

The design record is `reddoor-maintenance/docs/superpowers/specs/2026-08-31-starter-track-split-design.md`
(19 KB, landed in reddoor-maintenance#649). Its locked decisions: repo-per-track
(because `gh repo create --template` copies only the default branch), snapshot
first then native-ize (so the migration path is preserved byte-for-byte), and no
third template for Webflow.

---

## 3. The merge landmine — reproduced, and it is exactly as documented

The claim in `reddoor-maintenance/CLAUDE.md:194`, in the blux README banner, and
in `reddoor-starter-blux/CLAUDE.md` is: `git merge starter/main` applies #106's
178 deletions as clean, conflict-free removals, and **only `README.md` conflicts**,
so nothing warns you.

I reproduced it. To stay read-only on the real repos I made a `--shared` clone in
the scratchpad (objects alternate to the original; no ref, index or worktree of
`reddoor-starter-blux` was touched — `git status` there is still clean at `6b032e8`),
fetched native `main` into it, and ran the merge with `--no-commit`:

```
$ git clone --shared --branch main .../reddoor-starter-blux $SCRATCH/mergesim1
$ git -C $SCRATCH/mergesim1 fetch .../reddoor-starter main:native-current
$ cd $SCRATCH/mergesim1 && git checkout -b simA 329a5ce      # blux main as of 2026-09-01
$ git merge --no-commit --no-ff ac7660f                      # native main as of 2026-09-01
Auto-merging README.md
CONFLICT (content): Merge conflict in README.md
Automatic merge failed; fix conflicts and then commit the result.

$ git diff --name-only --diff-filter=U          # conflicted paths
README.md
$ git diff --cached --name-only --diff-filter=D | wc -l      # deletions staged silently
     178
$ git diff --cached --name-only --diff-filter=D | grep -ic blux
136
$ git diff --cached --name-only --diff-filter=D | grep 'tests/gate'
tests/gate/frozen-fidelity.spec.ts
tests/gate/pointe-fidelity.spec.ts
```

One conflict, 178 silent deletions, both fidelity gates gone. The documented claim
is correct to the file.

**Why it happens** is worth stating because it generalises: the merge base is the
snapshot point, the blux side had not touched any of those 178 paths since the
snapshot, and the native side deleted them. Three-way merge with "unchanged on
ours, deleted on theirs" is a clean delete — by design, not by bug. Any repo pair
created by "snapshot, then delete a subsystem in the parent" has this property.

### 3a. Today the warning looks weaker, and the danger is not

Run the same merge with today's heads (blux `6b032e8`, native `310df15`):

```
$ git checkout -b simB main && git merge --no-commit --no-ff native-current
... CONFLICT (modify/delete): src/lib/slices/BluxCarousel/index.svelte deleted in
    native-current and modified in HEAD. Version HEAD ... left in tree.   (×9)
... CONFLICT (add/add): docs/workJournal.md
... CONFLICT (content): src/routes/contact/+page.server.ts   (etc.)
$ git diff --name-only --diff-filter=U | wc -l
17
$ git diff --cached --name-only --diff-filter=D | wc -l
169
$ git diff --cached --name-only --diff-filter=D | grep -c blux
128
$ git diff --cached --name-only --diff-filter=D | grep -c '^src/lib/blux'
54
```

Seventeen conflicts now, because blux#5 (`182c663`, "cap Prismic srcset widths")
edited 9 of the deleted paths, so those became modify/delete. Someone running this
today would see a wall of conflicts and would plausibly conclude "git is warning
me". It is warning about 9 files and silently deleting 169 others — 128 of them
Blux, 54 of them under `src/lib/blux*`, plus both fidelity gates. The nine that
conflict are left in the tree **unstaged**; a `git add -A` while resolving takes
them back, but "resolve by accepting theirs" removes them too.

So the shape of the warning changed and the failure mode did not. If anything the
new shape is worse: it looks like git is doing its job.

---

## 4. How far the two tracks have diverged since 2026-08-31

Commits since the split (`82d93b0..main`, `--no-merges`): **native 16, blux 7**.

Blux has adopted five native improvements by cherry-pick (`git cherry` reports
all `+`, i.e. no patch-id matches, because each was adapted to a tree that still
has the Blux files):

| native         | blux         | subject                                 |
| -------------- | ------------ | --------------------------------------- |
| #108 `b36ec61` | #4 `b1ec870` | reusable workflow v1.4.1                |
| #109 `2dfd7b3` | #5 `182c663` | cap Prismic srcset widths, real `sizes` |
| #113 `50d0c86` | #6 `b59b9b2` | pnpm 11.11.0 [security]                 |
| #112 `7a6057b` | #7 `8980b21` | CMS-authored confirmation copy          |
| #114 `2e0746b` | #8 `6b032e8` | work-journal convention                 |

Native improvements blux has **not** taken: `141971b` + `af05a8f` (#107, close the
CI/local gate gaps + the canonical prettier reformat), `c714742` (#110, adopt the
shared configs), `2377e9c` (#111, SEO asserts `SITE_NAME`), `15abd0d` (#115, ten
retrospective rules → `CLAUDE.md` "Six rules", `figma-compare`, `a11yRoutes`),
`74768a3`/`a0c43f8` (#116/#117), `288fc57` (#122), `310df15` (#124, capability
index + prompt hook).

Tree-level divergence today (`git diff --name-status main native-current` in the
sim clone): **23 A, 178 D, 118 M, 3 R — 322 files, +3497 / −31016**.

The 23 files that exist only on the native side are the substance of the gap:

```
.prettierrc.json
docs/COMPONENTS.md  docs/NEW-SITE.md  docs/STARTER.md
scripts/capability-index.mjs  scripts/capability-index.test.ts
scripts/hooks/reuse-context.mjs  scripts/hooks/reuse-context.test.ts
scripts/figma-compare/{README.md,compare.mjs,extract-dom.mjs,ink.mjs,pull-figma.mjs,sample.mjs,sidebyside.mjs}
src/lib/page-load.ts  src/lib/page-load.test.ts
src/lib/page-meta.ts  src/lib/page-meta.test.ts
src/lib/site-config.ts
src/lib/slices/Accordion/mocks.json  src/lib/slices/TextColumns/mocks.json
src/lib/slices/RichText/RichText.test.ts
```

Plus, in `package.json` only on native: `verify`, `test:a11y`, and
`reddoor.a11yRoutes`. Plus `CLAUDE.md`: native is 255 lines with six hard-won
rules; blux is 84 lines (what-this-repo-is, two traps, the journal convention).

### 4a. The cherry-pick channel is already impaired

`af05a8f` (`style: reformat to the fleet's canonical prettier settings`) touched
80 files under a new `printWidth: 100` / double-quote config that blux never
adopted. Of the 118 files present in both repos but differing, **50 differ on the
native side by nothing except that reformat**:

```
of 118 shared-but-differing files:
  50 changed on the native side ONLY by af05a8f (the prettier reformat)
  68 have at least one substantive native commit
```

The consequence is measurable. Cherry-picking each unadopted native improvement
onto blux `main` in the sim clone:

```
CONFLICT 2377e9c  fix(seo): assert against SITE_NAME ...   -> src/lib/components/Seo.test.ts
CONFLICT 15abd0d  chore: the ten things a four-day build ... -> CLAUDE.md
CONFLICT 310df15  feat(docs): ship the capability index ...  -> .prettierignore CLAUDE.md
CONFLICT c714742  chore: adopt the shared configs ...        -> .gitignore eslint.config.js package.json pnpm-lock.yaml
```

Four for four. And the `2377e9c` conflict is provably the formatting, not the
content — the only two native commits to touch `Seo.test.ts` since the split are
`2377e9c` and `af05a8f`, and `af05a8f`'s own message says it is mechanical
(`prettier --write .`, "every diff is whitespace, a trailing comma dropped when a
call collapsed to one line") and that it was "kept as its own commit so it can be
dropped independently".

That is the actionable item hiding in this dimension: **the cheapest thing that
would restore the cherry-pick channel is to adopt `.prettierrc.json` in the blux
repo and run `prettier --write .` there once**, which would collapse 50 of the 118
divergent files to zero and remove the formatting layer from every future pick.
(I have not tested that — it is a recommendation, not a measurement.)

---

## 5. canvas-starter is a third lineage with no git relationship to either

This surprised me and matters for any "consolidate the templates" plan.

```
$ git -C canvas-starter cat-file -t bf9ead0
fatal: Not a valid object name bf9ead0        # the starter's root commit
$ git -C canvas-starter log --reverse --format='%h %ad %s' --date=short | head -1
0432062 2026-07-24 docs: canvas navigation design spec
$ git -C canvas-starter log --format='%h %s' --diff-filter=A -- src/lib/prismicio.js
65e8ecf chore: scaffold canvas-starter from reddoor-starter
```

It was **copied**, not forked: 31 commits of its own, starting with a design spec,
then one `scaffold` commit that dropped the starter's files in. There is no merge
base with either starter, so nothing can be cherry-picked in or out mechanically.

Because it was copied on 2026-07-24 — five weeks before the split — it froze a
snapshot of the pre-split library: 15 slices, which is the pre-split 28 minus the
11 `Blux*` minus `CtaBanner` and `Testimonial` (added 2026-08-11/31, after the
copy). It still carries `src/routes/dev/blux-page/` and `src/lib/blux*` residue.
It is also the only one of the three missing the `sharp@<0.35.0` transitive pin in
`pnpm-workspace.yaml` (native and blux both have it; canvas's overrides stop at
`cookie`), which is consistent with it having only one open sharp Renovate PR
(#23) where native and blux each have two (#118/#119, #9/#10).

Eight slices survive only in the blux and canvas lineages and exist nowhere in the
native line: `Carousel`, `CollectionList`, `Gallery`, `GridBand`, `LocationMap`,
`MediaFull`, `SplitFeature`, `TitleBand`.

canvas-starter is `isTemplate: false`, which matches its own README ("Prismic is
present but inert … so this can be promoted to a template later"). It has had
**no code development since 2026-07-24** — its journal says so and the log agrees:
of 31 commits, 13 are the build day, and everything after is Renovate/CI except
#4 (smoke expectation) and #20 (srcset, on inherited slices the canvas route does
not use).

---

## 6. What a new site actually inherits today

**Native track.** `gh repo create --template` produces a repo whose history is a
single squashed `Initial commit` — verified on the two most recent sites
(`29-navy` root `3b6ab20` 2026-09-08 `Initial commit`; `vida-legacy-foundation`
root `94f8435` 2026-09-01 `Initial commit`). **A generated site therefore has no
merge base with the starter**, which is why the starter's own journal describes
porting Beachfront's fixes back as "one PR per item" (#121) rather than a pick.

203 tracked files: 153 under `src/`, 23 root, 12 `scripts/`, 8 `docs/`, 3 `tests/`,
3 `customtypes/`, 1 `static/`. Concretely:

- 9 Prismic slices, each with `model.json` + `mocks.json` + `index.svelte` + a
  vitest suite; 29 components in `src/lib/components`; 49 test files total.
- `pnpm verify` = `lint → check → build → test:a11y → test` — "exactly what CI
  runs, in CI's order".
- `docs/STARTER.md` (stack notes), `docs/NEW-SITE.md` (everything still carrying a
  template default), `docs/COMPONENTS.md` (generated inventory),
  `docs/accessibility.md`, `docs/security.md`, `docs/workJournal.md`,
  `docs/migration.md`, `docs/recipes/`.
- `CLAUDE.md` (255 lines) with the six shipped-site rules and the journal convention.
- `scripts/figma-compare/` (the comp-measuring harness, upstreamed from a site in #115)
  and `scripts/capability-index.mjs` + `scripts/hooks/reuse-context.mjs` (#124).
- `.env.example`, `netlify.toml`, `lighthouserc.json`, `renovate.json`, CI pinned
  to the org reusable workflow at v1.4.1.
- The `your-prismic-repo-name` sentinel in `slicemachine.config.json`, load-bearing
  so a fresh clone builds green before the CMS exists.

**Blux track.** Everything above _minus_ the 23 native-only files, minus `verify`
and `test:a11y`, minus `reddoor.a11yRoutes`, minus `.prettierrc.json`, minus
`src/lib/site-config.*` and `page-load`/`page-meta` — _plus_ the whole Blux render
layer (`src/lib/blux`, `blux-catalog`, `blux-frozen`, 11 `Blux*` slices,
`/products/[slug]`, the frozen-page route, `tests/gate/{frozen,pointe}-fidelity.spec.ts`),
28 slices and 8 custom types. Its only stack documentation is the 157-line
`README.md`, which still carries pre-split rot: three separate `- **Layout** —`
bullets and two `- **UI** —` bullets listing overlapping component sets. That
duplication predates the split (`git show 82d93b0:README.md` has the same three
lines at 20/21/27); native fixed it by replacing `README.md` with a 12-line
site-facing stub and moving the content to `docs/STARTER.md`, which blux does not
have.

Also relevant to the `--track blux` path: the new-site skill's step **3b
"De-brand" is marked "(native track)"** and step 3c's `a11yRoutes`/`tests/smoke/routes.ts`
instructions assume files and keys the blux template does not ship in the same
shape. I did not run a blux bootstrap, so I cannot say what breaks — only that the
skill's per-step instructions are written against the native tree.

### 6a. Fleet-wide inheritance, measured

Across the 30 SvelteKit repos in `~/Documents/GitHub` (detected by
`@sveltejs/kit` in `package.json`):

```
with the Blux layer (src/lib/blux*):  6   beachfront-dentistry, canvas-starter,
                                          reddoor-starter-blux, the-pointe,
                                          the-pointe-burbank, the-tower-burbank
with package.json#reddoor.a11yRoutes: 3 / 30   reddoor-starter, 29-navy, vida-legacy-foundation
with pnpm verify:                     4 / 30   those three + reddoor-maintenance
with any prettier config:            21 / 30
with docs/STARTER.md:                 3 / 30   reddoor-starter, 29-navy, vida-legacy-foundation
with docs/COMPONENTS.md:              2 / 30   reddoor-starter, 29-navy
with docs/workJournal.md:            28 / 30
```

Read that as a dated stratigraphy: a site's feature set is a fossil of the day it
was generated. `a11yRoutes` landed in the template on 2026-09-05 (#115) and exists
on exactly the sites created at or after it. The `@reddoorla/maintenance` pin
ranges from `^0.75.0` (the-pointe) to `^0.93.1` (starter, blux, 29-navy) across
nine distinct versions.

The one mechanism that does propagate backwards is the shared reusable CI
workflow, which every live site pins at the same SHA (`8f9852c`, v1.4.1). The
exception is `the-pointe` at `4a32c3d` (v1.3.0), which is expected — that repo is
archived on GitHub per the fleet rules and cannot take a push.

---

## 7. Instruments that are blind, proved with a control

### 7a. CI's prettier step cannot see a single `.svelte` file in the blux lineage

The starter's `CLAUDE.md` asserts that with no config file `prettier --check .`
silently skips every `.svelte` file. I tested it rather than repeating it, with a
known-good control, using the blux repo's own prettier binary and a scratch
directory containing one deliberately mis-formatted `.ts` and one `.svelte`:

```
### CONTROL: badly-formatted .ts, no config          -> [warn] bad.ts        exit=1
### TEST C: DIRECTORY mode, no config, no --plugin   -> [warn] bad.ts        exit=1   (Bad.svelte NOT reported)
### TEST D: DIRECTORY mode, no config, WITH --plugin -> [warn] Bad.svelte, bad.ts     exit=1
### TEST E: DIRECTORY mode, WITH .prettierrc.json    -> [warn] Bad.svelte, bad.ts, .prettierrc.json  exit=1
```

The control passes (the harness does detect a badly-formatted file), so TEST C's
silence about `Bad.svelte` is a real negative, not a broken probe. Naming the file
explicitly instead errors (`No parser could be inferred`, exit 2) — it is
specifically **directory mode** that swallows it, which is the mode CI uses.

The org reusable workflow at `reddoorla/.github/.github/workflows/ci.yml` runs the
raw binary, not the package script:

```yaml
- run: pnpm exec prettier --check .
- run: pnpm exec eslint .
```

So for any repo with no prettier config, the CI formatting gate is blind to
`.svelte`. Prettier itself confirms which repos those are:

```
reddoor-starter-blux  prettier --find-config-path Accordion.svelte -> [error] Can not find configure file
canvas-starter        -> [error] Can not find configure file
data-dynamiq          -> [error] Can not find configure file
the-pointe-burbank    -> [error] Can not find configure file
the-tower-burbank     -> [error] Can not find configure file
```

All five keep the `--plugin prettier-plugin-svelte` flag in their own
`pnpm lint` script, so a developer running `pnpm lint` locally is covered; CI
never calls that script. `canvas-starter/CLAUDE.md` documents this correctly and
warns not to copy native's flag removal without the config.
`reddoor-starter-blux/CLAUDE.md` does **not** mention it — which is the live hazard,
because that repo's declared workflow is to cherry-pick from a native repo that
_has_ removed the flag (the flag came out and `.prettierrc.json` went in together,
in `141971b`).

Minor: blux's and canvas's lint script has a duplicated positional argument —
`prettier --check . --plugin prettier-plugin-svelte .` — harmless, but a sign
nobody has read it recently.

### 7b. Two gates in the blux/canvas templates default to measuring nothing

CI runs `pnpm exec reddoor-maint audit --only a11y --fail-on-violations`
unconditionally. `reddoor-maintenance/src/audits/a11y.ts:186-199` appends
`package.json#reddoor.a11yRoutes` to the fixture list; absent the key you get only
`src/configs/playwright-a11y.ts`'s two fixtures, `/dev/a11y-fixtures` and
`/dev/animate-in`. Neither blux nor canvas has the key anywhere
(`grep -arn a11yRoutes` finds nothing in `package.json`, `docs/`, `CLAUDE.md`,
`README.md`), so on the blux track the axe gate scans zero real pages and reports
green — and a site generated from it inherits that silence with no checklist file
telling it otherwise.

The native track is only half covered. `package.json` ships `reddoor.a11yRoutes: ["/"]`,
but `docs/NEW-SITE.md` — the file that describes itself as "the checklist that
survives without the skill" — **does not mention `a11yRoutes` or
`tests/smoke/routes.ts` at all**. The only place those instructions exist is
`/Users/tuckerlemos/.claude/skills/new-site/SKILL.md` step 3c, which is a local
skill file, not something a repo carries.

### 7c. The reuse-context hook ships inert

`#124` added `scripts/hooks/reuse-context.mjs` (tracked) as a `UserPromptSubmit`
hook that surfaces `docs/COMPONENTS.md` rows before an agent plans. Wiring it
requires `.claude/settings.json` — and `reddoor-starter/.gitignore` has:

```
# Local agent config — operator-specific, must not ship with the template
.claude/
```

So every generated site inherits the script and none inherits the wiring. The
starter's own checkout has only `.claude/settings.local.json`, no `settings.json`.
The single repo where the hook is actually wired is `29-navy` (`.claude/settings.json`
present) — which is where the mechanism was built (29-navy #25/#26, 2026-09-11)
before being upstreamed to the starter the same day as #124. `CLAUDE.md` names the
gap honestly ("that file is per-checkout until someone decides otherwise"), so this
is a known open decision rather than a defect.

---

## 8. The retracted merge instruction is still live in the spec and the plan

This is the finding I would act on first, because it is a landmine that the
corrected documentation points directly at.

`reddoor-maintenance/CLAUDE.md:194` carries the corrected rule
("**Cherry-pick, never `git merge starter/main`**") and closes with:

```
Design: docs/superpowers/specs/2026-08-31-starter-track-split-design.md.
```

That spec, tracked on `origin/main`, still says at line 72-74:

```
Merge direction is **starter → starter-blux only**. Shared improvements
(a11y, media, forms, CI, deps) land in `reddoor-starter` and are pulled into
the Blux repo with `git merge starter/main` (add the native repo as a remote
named `starter`).
```

and at line 79-82 predicts the conflict surface will be "small and localized" —
which is the belief the 2026-09-01 verification falsified in the worst possible
direction (it was not small, it was _zero_). The companion plan
`docs/superpowers/plans/2026-08-31-starter-track-split.md` repeats the instruction
twice, at line 146 ("pull shared improvements with `git merge starter/main`") and
line 1525 ("Forward-merge only (`git merge starter/main` in that repo)") — the
latter inside the exact `CLAUDE.md` block that was later rewritten.

Neither file carries a forward pointer. The repo already has the convention for
this (`CLAUDE.md`: "> Superseded in part by …"), invented for journal entries; it
has not been applied to specs and plans, which is where this particular reader
lands because `CLAUDE.md` sends them there.

Everything _else_ is corrected: `reddoor-starter-blux` README banner and
`CLAUDE.md` (via blux#2 and #8), and reddoor-maintenance `CLAUDE.md` (via the
2026-09-08 webflow plan's Task 5, whose verification item C6 checks exactly this).

---

## 9. Open loops

- **reddoor-starter#121 — Port Beachfront's generic product-quality fixes to the
  native starter** (opened 2026-09-09). The starter's journal quantifies it:
  fourteen generic fixes Beachfront made 2026-08-07 → 2026-09-02 (noindex prefixes,
  reveal state in markup, a focus-ring floor, live reduced-motion, modal
  scroll-lock, nav tap response) are absent from the template and "are already
  propagating into sites bootstrapped from it; Vida Legacy Foundation inherited
  five of them on 2026-09-01 and independently re-fixed a sixth." The journal calls
  it "the largest per-site saving measured anywhere in this work (~18% of a
  Beachfront-sized build, against ~10% for every conversion layer combined)". The
  issue plan is one PR per item. This is the single largest identified, unrealised
  win in the starter dimension.
- **reddoor-starter#120 — the placeholder-repo hatch greens build AND smoke over a
  site with no home page** (2026-09-09). Measured in the issue against `29-navy`:
  `VITE_PRISMIC_ENVIRONMENT=your-prismic-repo-name pnpm build` exits 0 with
  `build/index.html` absent and 5 files in `build/`, because
  `src/routes/[[preview=preview]]/+page.server.ts` `entries()` returns `[]`; and
  `tests/smoke/routes.ts:34-35` reads the _same_ variable and flips `/`'s
  expectation from 200 to 404, so smoke passes too. Both halves of the gate agree
  about a site that does not exist. Suggested fix: refuse the hatch when `CI` or
  `NETLIFY` is set.
- **reddoor-starter#123 — `Modal.svelte`: 20×20 close button, no accessible name
  on the dialog; `LandscapeModal` never …** (2026-09-11, title truncated in the
  listing; I could not fetch the body — see §10).
- **The blux formatting debt** (§4a). Four of four unadopted native improvements
  conflict on cherry-pick today; 50 of 118 shared-but-differing files differ only
  because of `af05a8f`.
- **Duplicate Renovate Dependency Dashboards**: `reddoor-starter` has both #16
  (2026-06-15) and #97 (2026-08-03) open; `canvas-starter` has #3 and #8. Consistent
  with the known Renovate App migration leaving old-identity artefacts behind.
- **Duplicate sharp security PRs**, open since 2026-09-09 on native (#118 "update
  dependency sharp to v0.35.4" and #119 "update dependency sharp@<0.35.0 to ^0.35.4")
  and blux (#9/#10). The second of each pair rewrites the pnpm **override key** in
  `pnpm-workspace.yaml`, which is the "brace-expansion" misread class already
  recorded in memory. canvas-starter has only #23 because it never had the sharp
  pin at all.
- **Stale local branches in `reddoor-starter`**: `feat/blux-product-detail`
  (2026-07-17, 4 ahead of main, has an upstream on origin) and
  `backup/pipeline-premerge-087c76f` (2026-07-23, **78 ahead**, no upstream, local
  only). Both are Blux work in the repo that no longer has the Blux layer. I
  checked whether the backup branch was the only copy of anything — it is not:
  `git rev-list backup/pipeline-premerge-087c76f --not --remotes | wc -l` returns
  `0`, and `git branch -r --contains 087c76f` reports
  `origin/feat/blux-catalog-pipeline`. Nothing is at risk; they are clutter.
- **`feat/cms-reply-copy` worktrees** still checked out in both starters
  (`reddoor-starter/.worktrees/reply-copy` at `eaa5dc2`,
  `reddoor-starter-blux/.worktrees/reply-copy` at `3500a65`) although the
  corresponding PRs (#112, blux#7) are merged. Local-only clutter; note that the
  fleet memory records stale worktrees as a source of wrong archaeology.
- **canvas-starter has been unattended since 2026-07-24** and is `isTemplate: false`.
  Its stated purpose ("so this can be promoted to a template later") is 7 weeks
  stale and it is now the only repo holding 8 slices from a deleted library
  generation. Deciding its fate — promote, fold the 8 slices into native, or
  archive — is a meta-week-sized question.

---

## 10. Attention, and where it does not go

From `sessions.jsonl` (3,469 sessions, window 2026-07-30 → 2026-09-12), matching
on `cwd`:

```
reddoor-starter       90 sessions  2,803 min  on 2 distinct days (2026-09-01 ×40, 2026-09-08 ×50)
reddoor-starter-blux   0 sessions
canvas-starter         0 sessions
```

Zero agent sessions have ever been opened in the blux or canvas checkouts in the
window — including the worktrees, which the match would have caught. The blux
repo's 7 post-split commits were produced from somewhere else (most plausibly
reddoor-maintenance sessions), and its five cherry-picks were done without anyone
working in the repo itself. Native attention is bursty and tied to the split
(09-01) and the Webflow-records/capability-index work (09-08), not continuous.

Commit authorship in the window: native 44 commits (31 Tucker / 13
`reddoor-renovate[bot]`), blux 25 (16 / 9), canvas 19 (9 / 10). More than half of
canvas's activity is the bot.

Prompts mentioning starter/blux/template/new-site: 325 across the corpus, and the
top project is not a starter — it is `29-navy` (90), then `reddoor-starter` (54),
`reddoor-website` (40), `vida-legacy-foundation` (30), `beachfront-dentistry` (25).
Template thinking happens **in the sites**, and reaches the template afterwards if
at all. The capability index is the clean example: built in 29-navy on 2026-09-11
(#25, #26), upstreamed to the starter the same day (#124). The fourteen Beachfront
fixes are the counter-example: found in a site, still not upstreamed a month later
(#121).

---

## 11. What I did not verify

- I did not run `pnpm install`, `pnpm build`, `pnpm verify`, or any test suite in
  any repo. Every "green" claim above comes from `runs.jsonl` (GitHub's own
  conclusions) or from a file read, never from me running the gate.
- I did not run a `--track blux` bootstrap, so the claim that the new-site skill's
  native-only steps (3b, 3c) mismatch the blux tree is read from the skill and the
  blux tree, not observed failing.
- I could not fetch the bodies of `reddoor-starter#121` and `#123`: after a working
  window, `gh` began failing with
  `Post "https://api.github.com/graphql": tls: failed to verify certificate: x509: OSStatus -26276`
  on both GraphQL and REST. Titles and dates come from the earlier successful
  `gh issue list`. #120's body was fetched before the failure and is quoted above.
- The claim that adopting `.prettierrc.json` + one `prettier --write .` in the blux
  repo would collapse the 50 formatting-only divergences is an inference from the
  reformat commit's own description; I did not run it.
- Merge and cherry-pick simulations were run in a throwaway `--shared` clone at
  `$SCRATCH/mergesim1`, never in the real repos. `git -C reddoor-starter-blux status`
  and `git log --oneline -1` were re-checked afterwards and are unchanged at
  `6b032e8` with a clean tree.

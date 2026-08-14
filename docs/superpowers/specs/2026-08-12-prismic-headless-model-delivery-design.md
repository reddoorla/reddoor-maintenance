# Headless Prismic model delivery — design

**Date:** 2026-08-12
**Status:** approved, ready for implementation planning
**Operator decisions:** Git stays authoritative · CI pushes on merge to main · write scope proven on `the-pinnacle`

## Problem

Every custom-type or slice-model change in the fleet requires the operator to
open Slice Machine locally and click Push. That manual step blocks agents from
shipping a schema change end-to-end, and it is the only reason a model change
cannot ride a normal PR.

The stated ask was "move the fleet onto Prismic's new type handling." Research
found that the new thing — Type Builder — is the opposite of what the ask
requires, and that the capability actually needed already exists and is
unwired. This design builds the delivery pipeline, not the migration.

## What the research established

Every claim below was verified by execution, not by reading docs. Claims that
were not proven are marked as such.

### Proven

| Probe                                                                                   | Result                                                |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `push-slice-models.mjs` dry run @ beachfront                                            | "All slice models match Prismic"                      |
| `GET /slices`, `GET /customtypes` @ beachfront                                          | 200 — 30 slices, 7 types (non-vacuous)                |
| Same GET @ the-tower-burbank, composition-hospitality, the-pointe-burbank, the-pinnacle | 200 ×4                                                |
| `PRISMIC_WRITE_TOKEN` (credentials.env) @ gallerysonder, reddoor-la                     | **403** — "explicit deny in an identity-based policy" |
| `POST /customtypes/insert` @ the-pinnacle                                               | **201**                                               |
| `DELETE /customtypes/{id}` @ the-pinnacle                                               | **204**, zero residue                                 |

The 403 row matters as much as the 200s. It reproduces the historical failure
that produced the standing "types can only push via Slice Machine" rule, and
localises it: the deny is a property of _that one older token_, not of the
Types API. Five per-site write tokens read and write fine. Same probe, five
passes and one controlled reproduction of the known failure — this satisfies
the prove-the-instrument rule in CLAUDE.md.

**Conclusion: headless, agent-driven Prismic schema changes work today.** No
Slice Machine, no Type Builder, no browser.

### Refuted — do not re-propose

1. **Type Builder is the answer.** It is an Admin-only human web UI that saves
   straight to the cloud with no branch, no PR, no CI. Adopting it removes Git
   as the gate and makes agent-driven modeling harder, not easier.
2. **The Prismic CLI enables CI auth.** `PRISMIC_TOKEN` is an undocumented
   _user session_ token validated against `user-service.prismic.io/profile`.
   It cannot bootstrap (`token create` and `push` both call the same auth
   getter first) and never refreshes when set via env. Dead end for CI.
3. **`prismic init` is a config rewrite.** It is destructive: it `rm -r`s any
   local slice directory absent from the remote — component code included —
   rewrites package.json and lockfile, AST-edits `vite.config.ts`, and makes
   remote writes to the live Prismic repo even under `--no-setup`. Not
   idempotent.
4. **Migration requires no file changes.** Model file shapes are unchanged, but
   `slicemachine.config.json` → `prismic.config.json` is mandatory for CLI
   adoption, and the CLI's `JSON.stringify(m, null, 2)` output reds `pnpm lint`
   fleet-wide (the fleet is `useTabs: true`).

### Not proven

- **Token expiry.** Undocumented. Unknown whether these write tokens expire.
- **Type Builder per-repo availability.** Never checked against a live fleet
  repo; the design does not need it.

## Two traps found while reconciling — both change the implementation

### The `""` → `null` trap (permanent false-positive drift)

Slice Machine writes image thumbnails to disk as `{"name":"desktop","width":1200,"height":""}`.
Prismic coerces that empty string to `null` on ingest. `canon()` filters `null`
but keeps `""`, so the remote copy loses the key while the local copy keeps it —
the two can **never** compare equal. A push sends `""`, Prismic stores `null`,
and the next scan diffs again. The nightly check would have alarmed on hedloc
forever.

Verified by round-tripping a thumbnail through the Types API on `the-pinnacle`:
sent `height:""`, read back `height:null`. Fix: `canon()` must drop `""`
alongside `null`. With that one change hedloc goes from DRIFT to CLEAN with no
push at all — there was never any real divergence.

**Process note worth keeping.** The probe that found this printed its own
verdict as "PRESERVED — a push would converge," which was wrong: it tested
`'height' in thumbnail` (the key survived) rather than the value (`"" → null`).
The raw sent/read-back lines told the true story. This is the same shape as the
setup-node probe in CLAUDE.md that grepped the wrong command — a verdict line is
itself an instrument and needs proving.

### Generated JSON must be formatted by the target repo's own prettier

The first pull-down PR failed CI on `prettier --check` for
`customtypes/frozen_page/index.json`, while `catalog_page/index.json` —
generated by the identical code path in the same run — passed. Formatting is
content-dependent, so the implementation cannot assume a canonical shape from
`JSON.stringify`. Pipe generated model JSON through the target repo's own
prettier (`--stdin-filepath <path-in-that-repo>`) before writing or uploading.

This is a variant of the CLI problem already recorded above: the fleet is
`useTabs: true` and prettier is enforced on every file in CI.

## Constraints discovered in the fleet

**Ordering constraint — reconcile before enabling push. ✅ DONE 2026-08-12.**
Enabling auto-push against a drifting fleet would overwrite the cloud with repo
state and silently destroy any model field the remote holds and the repo lacks —
the failure class that already cost 5 fields and 5–29% route divergence.
Reconciliation therefore came first, and the fleet now reads **11 of 11 CLEAN**.
See "Reconciliation performed" below.

**Blocking hazard — one Prismic repo, two Git repos. ✅ RESOLVED 2026-08-12.**
`the-tower` and `the-tower-burbank` both targeted Prismic repo
`the-tower-burbank` with different models, so auto-push would have made them
fight, last merge winning. `the-tower` was a redundant duplicate — 0
deployments, no open PRs, description "The Tower Burbank", last real commit
`fix(ci): point netlify-site at the-tower-burbank` — and has been **archived**
(reversible). `the-pointe` was separately deleted by the operator, so the
`POINTE_PRISMIC` token belongs to `the-pointe-burbank` — confirmed by a live
200 returning that repo's 9 types.

**Zero CI coverage today.** No workflow in any of the 25 repos references
Prismic. Content models are entirely ungated.

**The fleet is uniform.** 18 of 25 repos are Prismic sites; all share
`adapter: "@slicemachine/adapter-sveltekit"`, `libraries: ["./src/lib/slices"]`,
and the `"slicemachine": "start-slicemachine"` script. One codemod fits all.
Outliers: `alamo-anatomy` (config points at a non-existent slice dir),
`erp-industrial` (slice-machine-ui 1.x, a full major behind), and three repos
still carrying the `your-prismic-repo-name` sentinel.

## Reconciliation performed (2026-08-12)

Step 0 is complete. The fleet is at a clean baseline, so the pipeline can be
built against a fleet that already agrees with its cloud.

**Tokens.** Nine site tokens were minted by the operator into
`reddoor-maintenance/.env` as `<SITE>_PRISMIC`. Each was verified with a live
`GET /customtypes` + `GET /slices` **before** being written anywhere; eight were
distinct and working, and `POINTE_PRISMIC` proved to be a duplicate of the
existing the-pointe-burbank token. They were then distributed into each site
repo's own `.env` as `PRISMIC_WRITE_TOKEN` — the name every site's code already
reads — at mode `0600`, after confirming all nine repos gitignore `.env`.

Two naming conventions now coexist deliberately: the central stash keys by site
(`<SITE>_PRISMIC` / `<SITE>_WRITE_TOKEN`), each site repo uses the generic
`PRISMIC_WRITE_TOKEN`. The CI workflow should read the generic name.

**Writes.** 40 models pushed across the two drifting repos, 0 failures — to
the-tower-burbank, 11 slices and 6 types plus one additive `page` update; to
the-pointe-burbank, 15 slices and 7 types. Every push was proven non-destructive first by
checking that each remote field, slice-choice, and variation also existed
locally. Slices were pushed before custom types because `page` references
`blux_*` slice ids that must already exist. Three remote-only types were never
deleted; they came down as PRs instead
(the-tower-burbank#12, the-pointe-burbank#24 — both merged).

**Result: 11 of 11 CLEAN**, 0 unreachable — alamo-anatomy, caltex-landing,
erp-industrial, espada, gallerysonder, hedloc, medical-solutions-of-texas,
revogen, the-pointe-burbank, the-tower-burbank, vineyard-custom-homes.
Out of scope: beachfront-dentistry and reddoor-website (operator actively
working), data-dynamiq (no Prismic), the-pointe (deleted).

**Loose end:** `data-dynamiq` still ships a `slicemachine.config.json` pointing
at a Prismic repo named `reddoor-wireframer` despite having no Prismic. That is
vestigial and would produce a false drift alarm — remove it during rollout.

## Design

### 1 · `prismic-models` module in `@reddoorla/maintenance`

Port the proven logic from `beachfront-dentistry/scripts/lib/slice-models.mjs`
into `src/prismic/models/`:

- `canon(model)` — normalizes the meaningless diffs Prismic's serializer
  introduces: key order, injected `"select": null`, `imageUrl`, **and
  empty-string values**. The fourth is not in beachfront's version and must be
  added — see "The `""` → `null` trap" below.
- `localModels(repoRoot)` — reads `customtypes/*/index.json` and
  `src/lib/slices/*/model.json`
- `remoteModels(repo, token)` — GETs both Types API collections
- `diffModels(local, remote)` → `{ toCreate, toUpdate, unchanged, remoteOnly }`
- `pushModels(diff, { apply, allowDelete: false })`

**`remoteOnly` is reported, never deleted.** Deletion requires an explicit flag
and a human. This is the single most important safety property in the design:
a stale local checkout must never be able to remove a live content model.

### 2 · CLI command

`reddoor-maint prismic-models [site] --fleet <inventory> --workdir <path> --dry|--apply`

Follows the existing command shape (`src/cli/bin.ts:159`). Two modes: in-repo
(CI, runs against cwd, token from env) and fleet (central, iterates sites).
Sites already depend on `@reddoorla/maintenance`, so CI invokes the existing
`reddoor-maint` bin — no new public export surface is added.

### 3 · Reusable workflow in `reddoorla/.github`

- **`pull_request`** — read-only diff against the remote, posted as a PR
  comment. Never writes.
- **`push` to main** — `--apply`.

Paths-filtered to `customtypes/**` and `src/lib/slices/**/model.json`. Token
supplied as a per-repo Actions secret.

### 4 · Nightly drift check → cockpit

Compares repo main against the remote for every site; divergence raises a
cockpit alarm. This is the instrument for step-0 reconciliation, the detector
for out-of-band cloud edits, and the only thing that can catch the silent
field-drop class — a unit test cannot, because the local model is correct.

### 5 · Rollout

A `withRecipe()` recipe over the 4-stage `src/cli/fleet/` pipeline, landing
per-repo PRs per `AUTONOMY.md:49`, using `self-updating`
(`src/recipes/self-updating/index.ts:171`) as the PR-opening template.

Operator work that cannot be automated: minting ~12 more write tokens (5 of
~17 exist today, in `reddoor-starter/.env`). Distributing them as Actions
secrets _can_ be scripted via `gh secret set`.

### 6 · `AUTONOMY.md` clause

Live Prismic model writes are currently unclassified and are not
`git revert`-able. Proposed:

- Model push via CI on a merged PR — 🟢 (the PR was the review gate)
- Model **deletes** — 🔴 always
- Any fleet-wide model push outside CI — 🔴

### Slice Machine's fate

Unchanged by this design. It stays installed as a local visual authoring tool;
it simply stops being the delivery path. Slice Machine was declared unmaintained
on 2026-07-20 with no sunset date, and 2.21.5 shipped 17 days after that
announcement — there is time pressure but no fire. Removing it, and any move to
`prismic.config.json`, is a separate later decision made safer by the fact that
`prismic init` is destructive.

Policy while both exist: author in Slice Machine locally, commit, let CI push.
Do not click Push in Slice Machine. The drift check catches violations.

## Token handling

~17 write tokens, currently 5, living in a personal `.env`. They become
per-repo GitHub Actions secrets. Open questions for the operator: canonical
storage location, rotation owner, and behaviour when one expires mid-sweep
(expiry is undocumented — the drift check will surface it as a repo that
suddenly fails to read).

## Risks

- **Repo stops being source of truth** if Type Builder is ever enabled. Keep it
  off; the drift check is the backstop.
- **Auto-push overwrites cloud state** where drift exists. Mitigated by the
  ordering constraint and by `allowDelete: false`.
- **the-tower / the-tower-burbank collision.** Blocking; resolve first.
- **Token expiry is undocumented.** Drift check surfaces it as a read failure.
- **Undocumented, fast-moving Prismic surface.** Pin any CLI version if adopted
  later; 1.12 → 1.14 shipped in four weeks.

## Success criteria

1. An agent edits `customtypes/<id>/index.json`, opens a PR, the PR comment
   shows the model delta, and merging pushes it to Prismic with no human step.
2. `remoteOnly` models are never deleted by CI.
3. Nightly drift check reports zero divergence across the fleet after
   reconciliation.
4. The operator never opens Slice Machine to deliver a schema change again.

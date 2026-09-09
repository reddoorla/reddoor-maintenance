# Webflow rebuild pipeline — repeatable, with no third template

Status: approved in discussion 2026-09-08 (no third template; nothing
Webflow-specific in the native starter; content relationships as the default
list mechanism; one private skills repo; product-fix port deferred to an issue).
This document is the written record. First consumer: **29 Navy**
(`https://www.29navy.com/` → Prismic `29-navy`), bootstrapped at the end of the
same session.

Corrects, in part, `2026-08-31-starter-track-split-design.md`: its "the Webflow
importer targets the native `page` type" was a third true. The importer emits
`person`, `news_article` and `collection_item` documents, and Beachfront renders
them through `CollectionList` + a collections loader wired into the page route —
all of which exist in the Blux track and in Beachfront, none in native.

## Goal

Rebuild a Webflow site on the native stack with everything the Beachfront build
taught baked in, **without** any of it living in `reddoorla/reddoor-starter`.
Beachfront's tooling exists once, inside Beachfront, with defects a copy would
replicate. After this work it exists as versioned, tested, installable pieces
that a fresh native clone picks up by running commands, not by reading
Beachfront.

## What the Blux split taught, as a mechanism

The Blux layer corrupted the template not by size but by shape: hooks that
defaulted to nothing while every shared path paid for them. Two document types
probed per page load; slices reading a presentation context from a checked-in
empty manifest; a `band` field on 14 of 16 generic slices; six catalog types in
the editor's picker; a bare `catch` that turned every Prismic outage into a 404.
Native-ize (#106, `ac7660f`) changed 242 files and deleted 178.

The rule this spec follows: **the template ships no hook whose default does
work, and no field an editor cannot fill.** A "three-line seam" is the same
species; it was considered and rejected.

## Decisions

- **D1 — No third template.** The per-site delta is ~20 files of mechanism,
  none Webflow-specific, and the Blux track already shows the cherry-pick tax of
  a second template.
- **D2 — Nothing in the native starter.** Not custom types, not a collections
  slice, not a loader, not a seam in `page-load`. The starter gets one
  orientation line pointing at this pipeline.
- **D3 — Lists are content relationships by default.** A slice that shows
  documents of another type carries a repeatable group of content-relationship
  fields restricted to that type; the linked fields come back in the page query.
  Order is the group's order. No route change.
- **D4 — Automatic indexes are dedicated routes.** "Every document of type X"
  (a Q&A index, latest N) is a route with its own server load, like the contact
  route. A per-page fetch inside a slice zone is a documented site-side option,
  not a template mechanism.
- **D5 — The content model is conversion output.** Where a site has collections,
  the importer emits that site's custom types and documents into the site repo
  (`customtypes/<id>/index.json`, one-shot, refuse-if-exists) for a reviewable
  PR; delivery is the prismic-models workflow on merge. **Never slice models**
  (they orphan: the slice index and types regenerate only through the Slice
  Machine UI). **Never the direct Custom Types API** from the Webflow path.
- **D6 — The importer gets a second concrete site module, not a descriptor.**
  Its typed spine is a rewrite from N=1. The descriptor is extracted at site 3.
  29 Navy has no collections, so this is deferred entirely.
- **D7 — Matching tooling is installed by a maintenance recipe, invoked by the
  matching-a-page skill at Phase 0.** Maintenance owns the artefacts
  (versioned, tested, re-runnable upgrade); the skill owns the protocol.
- **D8 — Skills live in one private repo**, `reddoorla/claude-skills`, one
  directory per skill, linked into `~/.claude/skills`. None of the seven fleet
  skills has a remote today; two are local git repos, five are not repos.
- **D9 — Beachfront is the family reference, not a template.** Its family
  slices are copied per site only after a one-time de-Blux there, and only for
  a site in its family. 29 Navy is not.
- **D10 — The generic product fixes Beachfront made (noindex prefixes, reveal
  state in markup, focus rings, reduced-motion live read, modal lock, nav tap
  response) are deferred to a starter issue.** They are the largest per-site
  saving found (~18% of a Beachfront-sized build per future site vs ~10% for all
  the conversion layers together), but they are not a blocker for starting.
- **D11 — References die; capture them at Phase 0.** Found 2026-09-08 while
  auditing Beachfront's scripts: `beachfront-dentistry.webflow.io` now 404s on
  every path and `www.beachfrontdentistry.com` 301s to our own Netlify build,
  so Beachfront's paused campaign cannot be resumed against a live reference
  and its tools had been comparing the candidate with itself. (**The figure
  first written here, "three of its tools", is wrong — see #728.** Measured
  2026-09-09 across all 230 top-level scripts in `beachfront-dentistry/
matching/`: 33 assign a REF variable to `beachfrontdentistry.com` or `www.`,
  and 184 reference that host at all. Only five name the webflow.io host, and
  it 404s — so no script in that directory currently gates against a live
  reference. The "since 2026-08-10" date is also unsupportable from the tree:
  all of them entered git in one bulk commit, `c10a05b`, and nothing records
  when each began self-comparing. The decision below is unaffected, and if
  anything understated.) Every
  harness install therefore ships a fail-closed preflight (200, no redirect,
  reference fingerprint present, candidate fingerprint absent), and Phase 0
  captures the reference **with its assets** into `matching/spec/`. Gating
  against a captured reference (a local static server over the capture) is a
  follow-up issue, not this work.
- **D12 — Harness configuration is data, the read layer is code.** Sites edit
  `matching/harness.json` (reference, candidate, matrix, thresholds,
  fingerprints, the page table). `matching/harness.mjs` is recipe-owned: it
  loads the JSON and exports what every script needs, plus a small CLI the two
  bash gates consume. The three gate tools (page-diff, style-census, text-diff)
  stay in the matching-a-page skill, versioned by the skills repo, and are
  located through `MATCHING_SKILL_DIR` (default `$HOME/.claude/skills/matching-a-page`).
  Vendoring them into the package is a later decision, not this one.

## Homes

| Layer                                                             | Home                                                                                | Why                                                          |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Importer, per-site spine                                          | maintenance `src/webflow/sites/<slug>/`                                             | Already there, tested, owns the migration runner             |
| Seed runner, model-sync guard, migrate refusal                    | maintenance, beside `src/prismic/models`                                            | Generic Migration API tooling, not Webflow                   |
| Model delivery (prismic-models workflow)                          | maintenance `prismic-ci` recipe, run by `/new-site`                                 | Exists; wiring and the secret step are missing               |
| Round scripts, dev/match route, fixture test, site-pages scaffold | new maintenance recipe `match-harness`                                              | Versioned, remote-backed, content-compare upgrades           |
| The three gates, the phase protocol                               | `matching-a-page` skill, calling the recipe at Phase 0                              | The skill decides when; the recipe decides what              |
| The five rules, round protocol                                    | written into the site's `CLAUDE.md` by the recipe                                   | Process travels with the site                                |
| Generic product fixes                                             | starter, ordinary PRs, tracked by an issue                                          | Template quality, every site benefits                        |
| This design                                                       | maintenance `docs/superpowers/specs`, plus a starter journal entry correcting 08-31 | Where the split spec lives; history is never edited in place |

## The pipeline for a new site

1. `/new-site <slug>` bootstraps the repo, CI and protection; with a real
   Prismic repository name it mints `PRISMIC_WRITE_TOKEN` (operator, RED tier)
   and runs `reddoor-maint prismic-ci`, so model delivery exists from day one.
2. Where the site has collections: `reddoor-maint webflow capture` and `docs`
   with a new `sites/<slug>` module; custom types land in the site repo as a PR.
   29 Navy skips this step.
3. The matching-a-page skill's Phase 0 runs
   `reddoor-maint match-harness <site-path> --ref <url>`: the dev-guarded
   `/dev/match/[uid]` route, an empty `src/lib/site-pages.js`, the
   fixture-vs-model test, `matching/harness.json` (the single page table) with
   its read layer `matching/harness.mjs`, the round scripts, and the rules
   appended to `CLAUDE.md`. Then Phase 0 captures the reference with assets.
4. Slices are built per site and matched through the harness against the live
   reference; page assemblies are authored in `site-pages.js`.
5. `reddoor-maint prismic-seed <fixture> [site] --apply` publishes the
   assemblies through the Migration API and **refuses** until the remote models
   equal the repo's.
6. Launch: the dev guard makes the route inert (production 404, asserted by
   the launch recipe's probe); candidate paths in `harness.json` flip from
   twin routes to real routes and the specs follow; nothing is deleted.

## Components and their acceptance gates

Every gate is positive evidence — an artefact only a working system produces.
An absent error never passes a gate.

### C1 — `reddoorla/claude-skills`

Private repo; one directory per skill; `matching-a-page` and `rfp-analyze`
histories preserved if cheap, else flattened; build outputs, `node_modules`,
per-session `out-*` directories and any token-bearing file excluded before the
first commit; absolute machine paths replaced with `$HOME`/env.
Installed by symlinking each directory into `~/.claude/skills`.
**Gate:** on this machine, `~/.claude/skills/<name>` resolves into the clone
for all seven, each `SKILL.md` frontmatter parses (extend
`skill-frontmatter.test.mjs` to run over every skill), and `/matching-a-page`
still invokes.

### C2 — `match-harness` recipe (maintenance)

Installs into a site repo:

- `src/routes/dev/match/[uid]/+page.server.ts` + `+page.svelte` — renders
  `assemblies(devImg)[uid]` through the site's real `SliceZone`;
  `prerender = false`; **`if (!dev) error(404)`** at the top of `load`; no
  Blux imports; no collections loading (D3/D4 make it unnecessary).
- `src/lib/site-pages.js` — empty scaffold exporting `assemblies(img)`,
  `TITLES`, `META`, with the header comment that explains the single-source
  rule and the Migration API's silent field drop.
- `src/lib/site-pages.test.ts` — the generic fixture-vs-model tests
  (every fixture field is declared by its slice model's variation).
- `matching/harness.json` — data, site-edited: `ref`, `cand`, `matrix`,
  `threshold`, `maxHeightDelta`, `refMark`, `candMark`, `selfHosts`, and
  `pages` keyed by gate key with `uid`, `ref`, `cand`, `published`, `anchors`,
  `spec`, `group`. Seeded with `home` from `--ref`.
- `matching/harness.mjs` — recipe-owned read layer: loads the JSON and exports
  `REF`, `CAND`, `MATRIX`, `THRESHOLD`, `MAX_HEIGHT_DELTA`, `PAGES`, `byKey`,
  `TOTALS` (derived: anchors + 1, times the matrix), `specHeadingRe`,
  `SKILL_DIR`, `PD`, `SC`, `PLAYWRIGHT`, `REPORT_SCHEMA`; CLI `--env`
  (shell-safe assignments for the bash gates), `--table` (tab-separated page
  rows), `--check-ref` (the D11 preflight, exit 2 on failure).
- `matching/{gate.sh,census.sh,next.mjs,strikes.mjs,build-spec.mjs,census-count.mjs}`
  — the consolidated copies (see C3), every one importing from `harness.mjs`;
  `gate.sh` runs the preflight first; `next.mjs`/`strikes.mjs` **exit 2** on
  zero parseable runs or a report-schema mismatch, never 0.
- `matching/floors.mjs`, `matching/census-deviations.mjs` — empty site records
  with the matcher-signature comment; `matching/spec-sections/_chrome.md` and
  `_header.md`; `matching/LEDGER.md` header.
- `.gitignore` block under a marker — tracked scripts and records, ignored
  workspace (Beachfront's whitelist block verbatim plus `!matching/harness.json`).
- `CLAUDE.md` — appends the five rules and the round protocol under a marker.
  Install-if-absent for everything. Files a site edits (`harness.json`,
  `floors.mjs`, `census-deviations.mjs`, `spec-sections/*`, `LEDGER.md`,
  `site-pages.js`) are never overwritten. Recipe-owned scripts are byte-compared
  to the previous template and safe-replaced; a hand-edited one is flagged in
  the notes, never overwritten. The report schema version lives in the skill
  (`REPORT_SCHEMA` in `lib/report.mjs`, written into every report's `meta`,
  printed by `page-diff --version`) and the gate refuses on a mismatch.
  Not installed in v1: hover-sweep, gate-published, states, walk, summarize,
  anchor-parity probes — Beachfront-specific tools that stay there as records.
  **Gate (recipe test):** install into the pristine-starter fixture in a temp
  git repo (the maintenance recipe-test idiom); every installed file matches
  its template; `harness.json` parses with the given `--ref` and the default
  matrix; the `.gitignore` marker and the `CLAUDE.md` marker appear exactly
  once; a second run is `noop`; a missing `--ref` is `failed`; a seeded
  previous-version script is safe-replaced and a hand-edited one is flagged;
  `node matching/next.mjs` with no runs exits 2; `bash matching/gate.sh smoke
home` in the temp site exits 2 with the no-SPEC refusal (the Phase 1 gate
  working from the template). Site-side, on the first real install:
  `pnpm build && pnpm preview` and a request to `/dev/match/home` returns 404.

### C3 — Beachfront consolidation (one PR in beachfront-dentistry)

Create `matching/harness.json` (Beachfront's nine pages) and
`matching/harness.mjs`; replace the hand-duplicated page table, `REF`, `CAND`,
matrix, threshold and `$HOME` skill path in every script with imports (the
table was copied into at least nine files, and `walk.mjs` regex-parsed
`gate.sh` for it); delete the `gate-chrome.sh` reference; remove the sixteen
superseded `sweep*.sh`; add the report-schema handling; add the dev guard to
`dev/match`. Both reference hosts are dead (D11), so the proof is
mechanical rather than a live run.
**Gate:** `harness.mjs --table` prints nine rows byte-identical to the old
`run` lines; the derived totals equal the old hand-typed map; `gate.sh` on a
hyphenated tag still exits 2 with its message; `gate.sh smoke home` exits 2
**at the preflight**, naming the dead reference; `next.mjs` still honours
`PAUSED`; a forced schema mismatch makes `next.mjs` exit 2; `pnpm verify` is
green; the route returns 404 on `pnpm build && pnpm preview`. This PR is the
source the recipe copies from; the recipe is cut from it, not from the
current files.

### C4 — Seed and sync (maintenance)

- `reddoor-maint prismic-seed <fixture-module> [site] [--apply]`, dry by
  default: imports the site's pure fixture module, resolves images to asset
  ids, builds a `MigrationPlan`, runs the shared `runMigration`. The fixture
  contract is `export function documents(img): SeedDocument[]` where a
  `SeedDocument` is `{ type, uid, title, data }`, plus an optional `lang`.
  Repository name and token resolve the way the model tooling already does
  (`PRISMIC_TOKEN_<NAME>` from the maintenance credentials file), never a
  hard-coded sibling path; the output names the env var, never the value.
- `runMigration` gains a document title, an empty-object strip (Prismic
  rejects `{}` for an unfilled link or image), filename decoding for asset
  dedupe, and an optional explicit credentials argument with the env fallback
  kept for the Blux and Webflow callers.
- The sync check ported onto `src/prismic/models/{local,remote,diff}` and
  kept outside that directory's guarded export surface; called by
  `prismic-seed` and by `webflow migrate`, which **refuse** (exit 1, output
  beginning `REFUSED:`, naming each unregistered or differing model) when any
  model the plan touches differs from Prismic. Drift on untouched models is a
  warning, not a refusal.
- The Migration API facts that shipped defects (PUT replaces, a release cannot
  be read back, silent field drop) documented in the starter's
  `docs/migration.md` and `CLAUDE.md` Traps — true for every migration path.
- Beachfront's `push-slice-models.mjs` / `push-custom-types.mjs` retired in
  favour of `prismic-models`.
  **Gate:** a unit test proves `seed` refuses on a fixture whose model differs;
  a dry run against Beachfront's real repo reports the diff it would refuse on.

### C5 — new-site, matching-a-page, launch

- `/new-site`: after the sentinel is replaced, a step that sets
  `PRISMIC_WRITE_TOKEN` (`gh secret set`, operator-supplied value) and runs
  `reddoor-maint prismic-ci <slug>`; registers the site in maintenance's drift
  workflow token list. On the sentinel: skipped, and said so.
- `matching-a-page` Phase 0 / Workspace: replace the hand-created file list
  with the recipe invocation and the tracked-scripts/ignored-workspace rule.
- `launch` recipe: assert `/dev/match/<uid>` → 404 on the production build;
  flip specs from twin to real routes; no deletion step.
- `prismic-ci` template comment: Renovate does not bump the pin; the recipe
  re-run after each `.github` tag is the propagation mechanism.
  **Gate:** the prismic-models workflow has **one real run** — a harmless model
  PR on Beachfront (operator merges; RED tier) whose comment and apply jobs both
  succeed, with the run URL in Beachfront's journal.

### C6 — Records

- Starter journal entry correcting the 08-31 spec's claim (forward pointer
  under the 09-05 entry that summarised it, if that entry repeats the claim).
- Starter orientation table: one line, "Rebuilding from a live site".
- Maintenance `CLAUDE.md:116`: cherry-pick, never `git merge starter/main`.
- Starter issue for D10 with the per-fix inventory (commits, files, native
  counterpart, size).
- Issues for anything in this spec not landed in the session.

## 29 Navy — the first run

Recon (2026-09-08, live HTML + CSS, every URL fetched): one page; Webflow site
`61411d5add9b561004cfbf8b`; no CMS lists, no forms, no iframes, no web fonts
(system stack plus Font Awesome); a six-slide hero slider; a Location band
with an aerial image; a Lofts band with four floor triggers opening
floor-plan modals; six amenity modals (electric, laundry, gym, TV/internet,
ride, food) with partner logos and outbound links; Residents (two columns);
Contact (phone, `mailto:29navy@worthe.com`, address). 18 interaction trigger
nodes, all click-to-modal. Breakpoints 991 / 767 / 479 plus a 768 min.
Prismic `29-navy` is real, reachable and **empty** (one `master` ref, no
types, `en-us`), and no write token for it exists in the maintenance
credentials yet.

Assets, measured rather than assumed:

| From                                                 | Count            | State       |
| ---------------------------------------------------- | ---------------- | ----------- |
| Asset URLs in the HTML (with srcset variants)        | 58               | all 200     |
| Stylesheet                                           | 1 (61,774 bytes) | 200         |
| Font Awesome files (3 families × woff2/eot/woff/ttf) | 12               | all 200     |
| Background images referenced only from CSS           | 10 photos        | 200         |
| Floor-plan PDFs (`29navy.com/pdf/file1-4.pdf`)       | 4                | **all 404** |

Two corrections to an earlier reading of the same page. The asset count is 58,
not the 23 that counting `<img src>` alone gives. And **every floor-plan PDF is
dead** — 404 from the apex, from `www`, and over http, all four the same
906-byte Webflow "not found" page — so the download link in each floor-plan
modal is broken on the live site today. The four PDFs are a client deliverable,
not something the capture can recover. The `webflow-icons` face is a base64
data URI inside the CSS, so it needs no file.

Build shape: one `page` document (`home`) with roughly five site slices
(HeroSlider, LocationBand, FloorPlans, AmenityModals, ContactBand) and chrome
from `siteConfig`; images and, once supplied, PDFs shipped as real files
(never redrawn); modals as native `<dialog>` via the starter's Modal. No
collections, no importer, no relationships.

"Started" at the end of the session means: repo bootstrapped with Prismic
`29-navy` wired and model delivery installed; match-harness installed;
reference captured into `matching/spec/` — the HTML, the stylesheet, all 58
HTML assets, the 12 font files and the CSS-only backgrounds (D11: the client's
site will not outlive the cutover, and Beachfront's just did); Phase 0 and
Phase 1 of matching-a-page done (calibration, breakpoint matrix, fonts census,
interaction inventory, SPEC.md for `home`). Slices are the next session, and
the PDFs are an open question for the client.

## Risks

- **Time.** C1–C5 are two to three sessions of work by the earlier sizing; the
  minimum to bootstrap 29 Navy honestly is C1, C2 (with C3 as its source),
  and the new-site secret step of C5. C4 is needed before the first seed, not
  before the first slice. The plan is ordered so that a pause leaves a coherent
  state and the journal says where.
- **RED-tier steps.** Secrets, the Beachfront model-PR merge, and the Prismic
  repo itself are operator actions; the plan marks each and pauses there.
- **The recipe is cut from a moving source.** C3 must merge (or at least be
  reviewed) before C2 copies from it, or the recipe inherits the drift it was
  meant to fix.
- **Skill discovery via symlink** is already proven on this machine
  (`~/.claude/skills/rfp-analyze` is a symlink and is discovered); C1's gate
  re-verifies it after the cut-over, and every skill script's entry-point
  check must resolve the real path, the trap that symlink already hit once.
- **The gate tools have no version identity across repos.** Until the skills
  repo exists, a change to the report format cannot be pinned by a site. The
  schema version in every report and the `--version` flag are the minimum;
  the skills repo is what makes "the skill updated" an observable commit.
- **Model delivery has never run in production.** Beachfront's workflow is
  installed with the secret present and zero runs; the first-run PR in C3 is
  what turns the assumption into evidence before any site depends on it.

## Out of scope

Frozen-page (pixel-freeze) conversions of Webflow sites (fork the Blux track,
per the 08-31 spec); the importer descriptor (site 3); Beachfront's de-Blux
(only for a family site); the D10 product fixes (issue); i18n; the `settings`
custom type as a template default.

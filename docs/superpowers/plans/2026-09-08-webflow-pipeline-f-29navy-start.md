# 29 Navy — Bootstrap and Matching Phase 0/1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Leave `reddoorla/29-navy` bootstrapped on the native track with Prismic `29-navy` wired and model delivery installed, the `match-harness` installed, the live reference captured with every one of its 90 files, and matching-a-page Phases 0 and 1 complete (breakpoint matrix, fonts census, interaction inventory, `SPEC.md` for `home`) — so the next session writes slices against a measured spec instead of a screenshot.

**Architecture:** Nothing new is built here. `/new-site` produces the repo; plan E's `prismic-ci` step installs model delivery; plan BC's `match-harness` recipe installs the round scripts, the dev-guarded `/dev/match/[uid]` twin and `matching/harness.json`; this plan supplies the one artefact neither owns — a site-local `matching/capture-reference.mjs` that pulls the reference and its assets into `matching/spec/` and refuses to succeed quietly (spec D11) — and then drives the skill's Phase 0/1 protocol against that capture.

**Tech Stack:** `gh`, `reddoor-maint` (from the maintenance `dist/`), SvelteKit 2 / Svelte 5 starter, Node 24 builtin `fetch`, `@playwright/test` (already a starter devDependency, `package.json:30`), the `matching-a-page` skill's `page-diff.mjs` / `text-diff.mjs` / `style-census.mjs`.

**Depends on:**

| Plan               | Must have produced                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A (skills repo)    | `~/.claude/skills/matching-a-page` is a symlink into `~/Documents/GitHub/claude-skills/skills/matching-a-page`, and `page-diff.mjs --version` prints `report-schema 1`.                                                                                                                                                                                                                                                                                        |
| BC (match-harness) | `reddoor-maint match-harness [site] --ref <url>` exists in the maintenance `dist/`, installs `matching/{harness.json,harness.mjs,gate.sh,census.sh,next.mjs,strikes.mjs,build-spec.mjs,census-count.mjs,floors.mjs,census-deviations.mjs,spec-sections/{_chrome,_header}.md,LEDGER.md}`, `src/routes/dev/match/[uid]/{+page.server.ts,+page.svelte}`, `src/lib/site-pages.js`, `src/lib/site-pages.test.ts`, the `.gitignore` block and the `CLAUDE.md` block. |
| E (wiring)         | `resolveOwnerRepo(site)` in `src/util/git.ts` is used by `prismic-ci` (so a positional path works — today `src/recipes/prismic-ci/index.ts:113-116` refuses with "no Git repo on this site"), and `new-site/SKILL.md` carries steps 6b–6e.                                                                                                                                                                                                                     |
| D (seed)           | Not required. 29 Navy's first seed is a later session.                                                                                                                                                                                                                                                                                                                                                                                                         |

**Repos touched:**

| Repo                            | Branch                                                                                                                                                                                                                                                                                                 | Notes                                                                                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reddoorla/29-navy`             | `main` for the bootstrap commit only (Task 3 — before branch protection exists, exactly as `new-site/SKILL.md:99-101` prescribes), then `maint/match-harness-<ts>` (created by the recipe, Task 9) and `docs/29navy-phase-0-1` (Task 10 Step 1, cut from `main` AFTER the harness PR is squash-merged) | Never commit to `main` after Task 5. Never branch `docs/29navy-phase-0-1` off the recipe branch — its squash-merged commits would come back with it. |
| `reddoorla/reddoor-maintenance` | `chore/29-navy-drift-token` in a worktree at `~/Documents/GitHub/reddoor-maintenance/.worktrees/29-navy-drift-token`                                                                                                                                                                                   | The worktree is mandatory in the central repo (`CLAUDE.md:54`).                                                                                      |

**Assumptions:**

1. The Prismic repository `29-navy` already exists, is reachable and empty (one `master` ref, no types, `en-us`), so `/new-site` step 6's "create the repository" half is already done. Replacing the sentinel therefore arms loud-fail prerendering against an EMPTY repository, and that **fails `pnpm build` outright**: with a real `repositoryName`, `src/routes/[[preview=preview]]/+page.server.ts:19-21` makes `/` a prerender entry, `src/lib/page-load.ts:30-31` turns Prismic's miss into a 404, and `svelte.config.js:30-37` swallows a prerender 404 only `if (isPlaceholderRepo && status === 404)` — otherwise it rethrows. Task 3 therefore carries **one operator Prismic write** — push the repo's `page` type and publish a stub `home` document — and that is the only Prismic write in this plan.
2. The `match-harness` recipe seeds `harness.json` with Beachfront's matrix (`[1440, 834, 390]`) unless plan BC chose another default. Task 12 Step 4 replaces it with the matrix derived from the captured CSS; `harness.json` is a site-edited file the recipe never overwrites, so the derivation survives a re-run.
3. `matching/capture-reference.mjs` is site-local (tracked by the recipe's `!matching/*.mjs` whitelist, not installed by it). Promoting it into the recipe is a site-2 decision recorded in the journal, not an issue — nothing is broken by it living here for one site.
4. The capture also saves the three `<script src>` files and the two `<link rel="…icon">` files. The decided count list named only HTML/CSS/assets/fonts/CSS-photos; the skill's Phase 0 step 5 requires the scripts ("scripts are the ONLY reliable source for interaction and reveal timings") and Phase 5 depends on them, so they are captured as their own groups with their own asserted counts. This is a superset of the decision, not a contradiction.
5. The spec records the stylesheet as 61,774 bytes; fetched with a browser UA on 2026-09-08 it is **61,786** bytes. The capture therefore asserts group _counts_, never a byte size.
6. The seven-fetch verification of the reference (Task 9's expected numbers) was performed on 2026-09-08 21:5x UTC. A count failure has **two** causes, not one: the reference moved, **or** a classifier in `capture-reference.mjs` mis-sorted a URL (`FA_SVG` assumes Webflow's `<hash>_fa-<family>-<weight>.svg` basename, and anything unmatched falls through to `cssOther`). That is why the failure prints the offending URLs per group — read the `group` column in `CAPTURE.md` before concluding the reference changed.

---

## File structure

**`reddoorla/29-navy`** (clone at `~/Documents/GitHub/29-navy`)

| File                                | Change                                                                                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json:2`                    | `name` → `29-navy`                                                                                                                                |
| `.github/workflows/ci.yml:14`       | `netlify-site: "reddoor-wireframer"` → `"29-navy"`                                                                                                |
| `src/lib/seo.ts:7-8`                | `SITE_NAME` → `"29 Navy"`, `SITE_LOCALE` stays `en_US`                                                                                            |
| `slicemachine.config.json:2`        | sentinel → `"29-navy"` — and the operator write it forces (a `page` type plus a published stub `home` document), without which `pnpm build` fails |
| `README.md`                         | `<Site name>` / `<Client>` filled                                                                                                                 |
| `tests/smoke/routes.ts`             | unchanged at bootstrap (the single `/` entry flips from 404 to 200 automatically once the sentinel is replaced — `:34-48`)                        |
| `matching/harness.json`             | created by the recipe, then edited twice: `refMark`/`candMark`/`selfHosts` (Task 9 Step 3), then `matrix`/`pages.home.anchors` (Task 12 Step 4)   |
| `matching/capture-reference.mjs`    | **new** — the Phase 0 capture                                                                                                                     |
| `matching/probe-calibrate.mjs`      | **new** — root font-size, body width and the fonts census at every matrix viewport                                                                |
| `matching/probe-inventory.mjs`      | **new** — the `data-w-id` / widget / hidden-container inventory                                                                                   |
| `matching/CAPTURE.md`               | **new** — the generated, tracked manifest (the bytes in `matching/spec/` are git-ignored)                                                         |
| `matching/spec-sections/home.md`    | **new** — Phase 1 spec for the one page                                                                                                           |
| `matching/spec-sections/_header.md` | edited — site header prose for `build-spec.mjs`                                                                                                   |
| `matching/SPEC.md`                  | generated by `build-spec.mjs`                                                                                                                     |
| `matching/LEDGER.md`                | Phase 0 entry appended                                                                                                                            |
| `docs/workJournal.md`               | the repo's first entry                                                                                                                            |

**`reddoorla/reddoor-maintenance`**

| File                                            | Change                                                                                   |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `.github/workflows/fleet-prismic-drift.yml:107` | insert `PRISMIC_TOKEN_29_NAVY` above `PRISMIC_TOKEN_48BB12D1` (the list is alphabetical) |
| `docs/workJournal.md`                           | one entry                                                                                |

---

### Task 1: Prerequisites, proved before anything is created

**Files:** none — verification only.

- [ ] **Step 1: Prove plan A landed** — `readlink ~/.claude/skills/matching-a-page` prints a path under `~/Documents/GitHub/claude-skills/skills/`, and `node ~/.claude/skills/matching-a-page/page-diff.mjs --version` prints `page-diff <version> report-schema 1`. If either is absent, stop: this plan cannot run its gates.
- [ ] **Step 2: Prove plan BC landed** — `cd ~/Documents/GitHub/reddoor-maintenance && node dist/cli/bin.js match-harness --help` prints a usage line containing `--ref`. An "unknown command" here means the recipe is not built into `dist/`; run `pnpm build` there first.
- [ ] **Step 3: Prove plan E landed** — `grep -n 'resolveOwnerRepo' src/util/git.ts src/recipes/prismic-ci/index.ts` returns a hit in **both** files. Without it, `prismic-ci ~/Documents/GitHub/29-navy` fails at `src/recipes/prismic-ci/index.ts:113-116` with `no Git repo on this site`, and Task 7 has no positional path.
- [ ] **Step 4: Record the starting state** — `gh repo view reddoorla/29-navy` is expected to fail with `Could not resolve to a Repository`. Paste that line; it is what makes Task 2's `gh repo create` a creation rather than a silent re-use of someone else's repo.

---

### Task 2: Create and clone the repo (`/new-site` steps 1–2)

**Files:** Create: `~/Documents/GitHub/29-navy/` · Modify: `~/Documents/GitHub/29-navy/package.json:2`

- [ ] **Step 1: Create from the native template**

```bash
gh repo create reddoorla/29-navy --public --template reddoorla/reddoor-starter
git clone https://github.com/reddoorla/29-navy.git ~/Documents/GitHub/29-navy
```

`--private=false` does not parse in current `gh`; it wants the bare `--public` (`new-site/SKILL.md:19`).

- [ ] **Step 2: Verify the clone is the native template, not blux** — `cd ~/Documents/GitHub/29-navy && test ! -d src/lib/blux && grep -c '"@slicemachine/adapter-sveltekit"' package.json` prints `1` and the `test` exits 0.
- [ ] **Step 3: Rename the package** — in `package.json:2`, `"name": "sveltekit-prismic-starter-t-lemos"` → `"name": "29-navy"`. This drives the audit's slug matching.
- [ ] **Step 4: Verify** — `node -p "require('./package.json').name"` prints `29-navy`.
- [ ] **Step 5:** no commit yet — Task 3 commits the whole bootstrap as one change.

---

### Task 3: Bootstrap config edits and the first push (`/new-site` steps 3, 3b, 3c, 6, 8)

**Files:** Modify: `.github/workflows/ci.yml:14` · `src/lib/seo.ts:7` · `slicemachine.config.json:2` · `README.md`

- [ ] **Step 1: CI input** — `.github/workflows/ci.yml:14`

```yaml
netlify-site: "reddoor-wireframer"
```

becomes

```yaml
netlify-site: "29-navy"
```

- [ ] **Step 2: De-brand** — `src/lib/seo.ts:7`, `export const SITE_NAME = "Reddoor";` → `export const SITE_NAME = "29 Navy";`. Leave `SITE_LOCALE = "en_US"` (`:8`) and `DEFAULT_OG_IMAGE = ""` (`:20`) — there is no 1200×630 card yet, and a Reddoor-branded default is deliberately not shipped. Fill `<Site name>` / `<Client>` in `README.md`. Leave `src/app.html:2` `<html lang="en">` — the reference is English-only.
      **Do not extend the CSP.** The reference loads no web fonts (system stack plus three Font Awesome faces, all self-hosted on the Webflow CDN) and the rebuild ships the captured images as real files under `static/`, so no third-party image host is needed — the `devMatchImgHosts` dev-only CSP hole Beachfront carries (`beachfront-dentistry/svelte.config.js:44-45`) has no counterpart here.
- [ ] **Step 3: Gates at real routes** — `package.json:22-26` already ships `"reddoor": { "a11yRoutes": ["/"] }` and `tests/smoke/routes.ts:37-48` already ships the single `/` entry whose expectation is keyed on the sentinel (`:35`). Both are correct for a one-page site; nothing to change. Record that you checked, per `new-site/SKILL.md:35-52` — the failure mode there is an empty list reporting green.
- [ ] **Step 4: Build locally while the sentinel still stands** — the last build that can pass with no Prismic content at all:

```bash
cd ~/Documents/GitHub/29-navy && pnpm install && pnpm build
ls .svelte-kit/output/prerendered/pages build/index.html 2>&1 | tail -5
```

Expected: `vite build` succeeds, and neither that listing nor `build/` contains an `index.html` — with the sentinel in place `entries()` returns `[]` (`src/routes/[[preview=preview]]/+page.server.ts:19-21`), so `/` is never prerendered. That absence is the placeholder state, and the next step ends it.

- [ ] **Step 5: Replace the sentinel** — `slicemachine.config.json:2`, `"repositoryName": "your-prismic-repo-name"` → `"repositoryName": "29-navy"`. This re-arms loud-fail prerendering by design and flips `tests/smoke/routes.ts:35` `isPlaceholderRepo` to `false`, so `/` is now expected to return **200**.
- [ ] **Step 6: Watch loud-fail prerendering arm itself — this build MUST fail**

```bash
cd ~/Documents/GitHub/29-navy && pnpm build; echo exit=$?
```

Expected: non-zero. **Measured 2026-09-08: it is a 500, not a 404** — `Error: [function at(..)] unexpected field 'my.page.uid'`, because an empty Prismic repository has no custom types, so the Content API rejects the PREDICATE rather than returning no document. `page-load.ts:30-31` maps only `NotFoundError` to 404, so this rethrows unmapped and `svelte.config.js:34` rethrows again because its escape clause is `status === 404`. That is still the chain working — `entries()` now returns `[{}]`, the load calls `loadPage(client, "home")`, `src/lib/page-load.ts:30-31` turns Prismic's `NotFoundError` (empty repository) into a 404, and `svelte.config.js:34-36` rethrows it because `isPlaceholderRepo` is now false. A `RepositoryNotFoundError` instead means the repository NAME is wrong, not that the document is missing — it extends `NotFoundError` and `page-load.ts:30` deliberately lets it through. And an `unexpected field 'my.page.uid'` error is a THIRD outcome the first draft of this plan missed: the repository name is RIGHT and the `page` custom type has never been pushed to it.
**Do not commit yet.** From this edit until a `page` document with uid `home` is published, `pnpm build` fails and so does CI. The only build that still works without content is the placeholder override, which both `svelte.config.js:8-10` and `tests/smoke/routes.ts:34` honour — `VITE_PRISMIC_ENVIRONMENT=your-prismic-repo-name pnpm build` — and it is an emergency hatch, not a substitute for Step 7.

- [ ] **Step 7: OPERATOR (RED tier): push the `page` type and publish a stub `home` document.** Two writes into Prismic `29-navy`, both by the operator:
  1. **Push the repo's own model, do not hand-draw one.** `cd ~/Documents/GitHub/29-navy && pnpm slicemachine`, then in the local UI push the `Page` custom type. The repo already ships `customtypes/page/index.json` — Main tab `uid` (UID), `title` (StructuredText), `slices` (Slices), plus an SEO tab. Prismic dashboard → Custom Types → create `page` is the fallback if Slice Machine will not authenticate.
  2. **Create one `Page` document** with UID **`home`**, title `29 Navy`, no slices, and **publish** it. It is a placeholder the slice session overwrites; it exists so the site has content at all.

  Agent verification afterwards, in this order:

```bash
cd ~/Documents/GitHub/29-navy
node -p "require('./slicemachine.config.json').repositoryName"   # 29-navy
pnpm build; echo exit=$?                                          # exit=0
test -f build/index.html || test -f .svelte-kit/output/prerendered/pages/index.html && echo prerendered
```

`prerendered` is the positive artefact — `build/index.html` is the prerendered home page adapter-netlify publishes (`netlify.toml` `publish = "build/"`), and it exists only because Prismic answered with a real document. A green build alone is not evidence — the sentinel could have crept back, which is why the first line is checked too.
If the operator is unavailable, do **not** improvise. Push nothing, print the checklist per `new-site/SKILL.md:119-120`, and stop. Pushing a knowingly red `main` makes Task 4's ruleset require a check that cannot pass, and every later PR in this plan would then need an OPERATOR `--admin` merge.

- [ ] **Step 8: Commit and push to `main`, then read the run**

```bash
cd ~/Documents/GitHub/29-navy
git add -A && git commit -m "$(cat <<'EOF'
chore: bootstrap 29-navy

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
git push origin main
gh run list --limit 1 --json conclusion,displayTitle,url
```

A PR is unnecessary noise on an empty repo's first config commit, but CI must go green on `main` afterward — read the `conclusion` explicitly, never infer from silence (`new-site/SKILL.md:99-101`). Expect `"conclusion": "success"`, smoke included: with the sentinel gone, `tests/smoke/routes.ts:35` flips `isPlaceholderRepo` to `false` and `/` is expected to return **200**, which the published stub satisfies. A `failure` here means Step 7 did not actually land — re-read its three verification lines rather than re-running in hope.

---

### Task 4: Branch protection and the fleet row (`/new-site` steps 4–5)

**Files:** none in the site repo.

- [ ] **Step 1: Protection, via the recipe** — run AFTER Task 3's push (the ruleset requires PRs for every change to `main`, so protecting first bounces the bootstrap commit):

```bash
cd ~/Documents/GitHub/reddoor-maintenance
node dist/cli/bin.js self-updating ~/Documents/GitHub/29-navy
```

Registered at `src/cli/bin.ts:214`. Never hand-roll `gh api` for protection.

- [ ] **Step 2: Verify protection, and read whether `ci / ci` came back required**

```bash
gh api repos/reddoorla/29-navy/rulesets --jq '.[].name'
for i in $(gh api repos/reddoorla/29-navy/rulesets --jq '.[].id'); do
  gh api repos/reddoorla/29-navy/rulesets/$i \
    --jq '.rules[] | select(.type=="required_status_checks") | .parameters.required_status_checks[].context'
done
```

The first names the canonical ruleset; the second prints `ci / ci` or nothing. The recipe requires that context only once it has been OBSERVED on `main` (`src/recipes/self-updating/index.ts:278-296`, via `checkContextObserved` in `src/github/gh.ts:607-626`, which counts a check-run **by name regardless of its conclusion**), so after Task 3's push it will normally be required. That is safe **because Task 3 Step 7 left `main` green** — and it is precisely why a knowingly red `main` was not an option: a required check that cannot pass blocks the Task 9 and Task 15 PRs, whose only escape is an OPERATOR `--admin` merge. Never force the context on by hand; that is the evidence gate.

- [ ] **Step 3: Fleet row** — from the maintenance checkout (site repos lack the fleet's own deps):

```bash
cd ~/Documents/GitHub/reddoor-maintenance
node dist/cli/bin.js ensure-site 29-navy --name "29 Navy" --url https://29-navy.netlify.app
```

Registered at `src/cli/bin.ts:571`. **`--name` is required here and is CREATE-ONLY** — it is set at `src/reports/airtable/ensure-site.ts:76` and `consider()` at :102-104 re-checks only url, pointOfContact and gitRepo, so a re-run cannot fix it. Omitting it writes the slug `29-navy` as the client-facing row title and the CLI says so in a warning. `--contact` needs the client's email — ask the operator rather than guessing. The row's Git repo defaults to `reddoorla/29-navy` (`src/reports/airtable/ensure-site.ts:76`).

- [ ] **Step 4: Verify the row** — re-run the same command; it reports `exists`. That re-run is the positive artefact.

---

### Task 5: OPERATOR — Netlify and the Prismic write token

**Files:** none.

- [ ] **Step 1: OPERATOR (RED tier): Netlify site.** Create the site named `29-navy` at app.netlify.com, link `reddoorla/29-navy`, accept the build settings from `netlify.toml`. Then set env vars: `FORMS_INGEST_URL=https://reddoor-maintenance.netlify.app/api/forms/29-navy`, `FORMS_INGEST_TOKEN` (shared value, operator pastes). `PUBLIC_TURNSTILE_SITE_KEY` is **not** needed — the reference has no forms. Renovate needs nothing (org-wide GitHub App).
      Agent verification afterwards: `curl -sI https://29-navy.netlify.app/robots.txt` returns 200 and `curl -s https://29-navy.netlify.app/robots.txt | grep Sitemap` shows the real origin, not `localhost`.
- [ ] **Step 2: OPERATOR (RED tier): mint the Custom Types API write token.** Prismic dashboard → repository `29-navy` → Settings → API & Security → create a **write token for the Custom Types API** (not a content token, not the CLI's `PRISMIC_TOKEN` — runbook §3, `docs/runbooks/prismic-model-delivery.md:54`). Do not paste the value into the chat.
- [ ] **Step 3: OPERATOR (RED tier): set both secrets, pasting at the prompt, never on the command line.**

```bash
gh secret set PRISMIC_WRITE_TOKEN --repo reddoorla/29-navy
gh secret set PRISMIC_TOKEN_29_NAVY --repo reddoorla/reddoor-maintenance
```

`29-navy` upper-snakes to `29_NAVY` by `prismicTokenEnvName` (`src/prismic/models/token.ts:27-39`), so the central name is `PRISMIC_TOKEN_29_NAVY`.

- [ ] **Step 4: Verify both, by name** — `gh secret list -R reddoorla/29-navy` shows `PRISMIC_WRITE_TOKEN`, and `gh secret list -R reddoorla/reddoor-maintenance | grep PRISMIC_TOKEN_29_NAVY` prints one row. Names only; never echo a value.

---

### Task 6: Register 29 Navy in the nightly drift sweep

**Files:** Modify: `~/Documents/GitHub/reddoor-maintenance/.github/workflows/fleet-prismic-drift.yml:107` · `~/Documents/GitHub/reddoor-maintenance/docs/workJournal.md`

- [ ] **Step 1: Worktree** — `cd ~/Documents/GitHub/reddoor-maintenance && git worktree add .worktrees/29-navy-drift-token -b chore/29-navy-drift-token origin/main`. The worktree rule is mandatory in the central repo (`CLAUDE.md:54`).
- [ ] **Step 2: Edit** — the env list is alphabetical and today begins:

```yaml
PRISMIC_TOKEN_48BB12D1: ${{ secrets.PRISMIC_TOKEN_48BB12D1 }}
PRISMIC_TOKEN_ALAMO_ANATOMY: ${{ secrets.PRISMIC_TOKEN_ALAMO_ANATOMY }}
```

Insert one line above it (`2` sorts before `4`):

```yaml
PRISMIC_TOKEN_29_NAVY: ${{ secrets.PRISMIC_TOKEN_29_NAVY }}
PRISMIC_TOKEN_48BB12D1: ${{ secrets.PRISMIC_TOKEN_48BB12D1 }}
```

- [ ] **Step 3: Verify** — `grep -n 'PRISMIC_TOKEN_29_NAVY\|PRISMIC_TOKEN_48BB12D1' .github/workflows/fleet-prismic-drift.yml` prints the two lines in that order, and `node -e "require('js-yaml')" 2>/dev/null; python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/fleet-prismic-drift.yml'))"` exits 0 (the file still parses).
- [ ] **Step 4: Write the maintenance journal entry, in this worktree** — append to `~/Documents/GitHub/reddoor-maintenance/.worktrees/29-navy-drift-token/docs/workJournal.md`. It goes in **here**, with the change it describes: Step 6 merges the PR, deletes the branch and removes the worktree, so an entry attempted after that has nowhere to land.

```markdown
## 2026-09-08 — 29 Navy joins the nightly Prismic drift sweep (`chore/29-navy-drift-token`)

`PRISMIC_TOKEN_29_NAVY` was minted and set in this repo's Actions secrets, and
the drift workflow's env list is hand-maintained, so a new Prismic repository
reaches the sweep only when someone edits it. The list is alphabetical and
`29_NAVY` sorts above `48BB12D1`.

It changes nothing yet: `src/inventory/airtable.ts:46-51` filters pre-launch
sites out of every fleet operation, so 29 Navy gets no nightly verdict until its
Websites row leaves `building`. Until then the site's own `prismic-models`
workflow is its only guard — which is the same shape that left VLF unwatched for
a month, so the line goes in now rather than at launch, when it would be one
more thing to remember.
```

- [ ] **Step 4b: Adversarial review before the PR** — maintenance PRs get one; a workflow edit that resolves a secret is exactly the class where a name mismatch is invisible. Run `superpowers:requesting-code-review` on the diff, or self-review against `.github/workflows/fleet-prismic-drift.yml:107-121` and `src/prismic/models/token.ts:27-39`: the inserted name must be byte-identical to what `prismicTokenEnvName("29-navy")` returns (`"29-NAVY"` → non-alphanumerics collapse to `_` → `29_NAVY` → `PRISMIC_TOKEN_29_NAVY`) **and** to the secret set in Task 5 Step 3. A mismatch resolves to an empty string and the sweep reports nothing for the site, silently — the failure this line exists to prevent. Paste the verdict into the PR body.
- [ ] **Step 5: Commit and open the PR**

```bash
git add .github/workflows/fleet-prismic-drift.yml docs/workJournal.md
git commit -m "$(cat <<'EOF'
ci(drift): 29 Navy's Prismic token reaches the nightly sweep

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
git push -u origin chore/29-navy-drift-token
gh pr create --repo reddoorla/reddoor-maintenance --base main \
  --title "ci(drift): 29 Navy's Prismic token reaches the nightly sweep" \
  --body "$(cat <<'EOF'
`PRISMIC_TOKEN_29_NAVY` is set in this repo's Actions secrets; without this env line the nightly sweep resolves it empty and reports nothing for 29 Navy.

29 Navy stays outside the sweep until its Websites row leaves `building`/`launching` (`src/inventory/airtable.ts:46-51`), so the per-repo `prismic-models` workflow is its only guard until launch. This line is what makes the nightly one the day that changes.

**No changeset, deliberately** — this touches `.github/workflows/`, not `src/`, so nothing in the published `@reddoorla/maintenance` package changes and a version bump would announce a release that ships no code. Recording the carve-out here rather than leaving it as a silent omission.

**Adversarial review:** <paste the Step 4b verdict>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: Merge when CI is green** — `gh pr checks <n> --repo reddoorla/reddoor-maintenance --watch` then `gh pr merge <n> --squash --delete-branch`. GREEN tier. Then `git worktree remove .worktrees/29-navy-drift-token`.

---

### Task 7: Install model delivery (`/new-site` steps 6c–6d)

**Files:** Create (via the recipe's PR): `~/Documents/GitHub/29-navy/.github/workflows/prismic-models.yml`

- [ ] **Step 1: Run the recipe positionally from the maintenance checkout** (its `credentials.env` supplies `GITHUB_TOKEN`):

```bash
cd ~/Documents/GitHub/reddoor-maintenance
node dist/cli/bin.js prismic-ci ~/Documents/GitHub/29-navy
```

Registered at `src/cli/bin.ts:244`.

- [ ] **Step 2: Read the result against the four documented outcomes** —
  - `applied: opened PR <url>` → go to Step 3.
  - `noop: not a Prismic site (no repositoryName) — skipped` → the sentinel is still in `slicemachine.config.json`; Task 3 Step 5 did not land. Fix and re-run. **This is not delivery.**
  - `failed: … has no PRISMIC_WRITE_TOKEN Actions secret` → Task 5 Step 3 did not land.
  - `failed: … lockfile pins @reddoorla/maintenance X, which has no prismic-models command` → bump the dep and commit the lockfile. The starter resolves 0.93.1 ≥ the 0.83.0 floor, so a fresh clone will not hit this.
  - `noop: delivery workflow already current on main` → already done; idempotent.
- [ ] **Step 3: Merge the recipe's PR** — check its real changed-file list first (`gh pr view <n> --repo reddoorla/29-navy --json files --jq '.files[].path'` must show only `.github/workflows/prismic-models.yml`), then `gh pr merge <n> --squash --delete-branch`. GREEN tier.
- [ ] **Step 4: Verify the workflow exists and is active** — `gh workflow list -R reddoorla/29-navy` shows `prismic-models  active`. Note honestly in the journal that a workflow with **zero runs proves nothing**; its first real run is the first model PR of the slice session (the same gate the spec's C5 puts on Beachfront).

---

### Task 8: `/new-site` verification block

**Files:** none.

- [ ] **Step 1: Local build** — `cd ~/Documents/GitHub/29-navy && pnpm verify`. That is exactly what CI runs, in CI's order (prettier → eslint → svelte-check → build → axe audit → unit + smoke — `package.json:6`). Expect **green throughout**, smoke included: Task 3 Step 7 published the `home` document, so `/` returns 200 and `tests/smoke/routes.ts:35` expects 200. A build-stage failure naming `404 /: Page not found` means the document is not published (or was published in a draft state) — go back to Task 3 Step 7; it is not a matching problem and nothing downstream will work around it.
- [ ] **Step 2: CI conclusion** — `gh run list -R reddoorla/29-navy --limit 3 --json conclusion,displayTitle` — read the conclusions.
- [ ] **Step 3: a11y routes, and WHICH ones ran** — `pnpm test:a11y` is green, and while it runs, poll `ls .reddoor-a11y-spec-*/a11y.spec.ts` and read its `const pages`. The pass summary reads `0 violations across 2 routes` regardless of how many it ran (reddoor-maintenance #697), so the summary is not evidence.
- [ ] **Step 4: Renovate** — `gh workflow list -R reddoorla/29-navy` shows `renovate active`; the cron is `0 */12 * * *`. Do not block on the first run.
- [ ] **Step 5: Print the checklist of anything not yet done and stop there** — do not improvise around a missing operator step (`new-site/SKILL.md:119-120`).

---

### Task 9: Install the match harness (matching-a-page Phase 0, first act)

**Files:** Create (via the recipe): `matching/*`, `src/routes/dev/match/[uid]/*`, `src/lib/site-pages.{js,test.ts}`, `.gitignore` block, `CLAUDE.md` block

- [ ] **Step 1: Run the recipe**

```bash
cd ~/Documents/GitHub/reddoor-maintenance
node dist/cli/bin.js match-harness ~/Documents/GitHub/29-navy --ref https://www.29navy.com
```

It commits to a local `maint/match-harness-<ts>` branch in the site and does not push. Do **not** pass `--matrix`: the matrix is Phase 0's job to _derive_ from the captured CSS (Task 11), and `harness.json` is a site-edited file the recipe never overwrites.

- [ ] **Step 2: Verify the install, file by file**

```bash
cd ~/Documents/GitHub/29-navy
git log --oneline -1                       # the recipe's commit
node -e "const h=require('./matching/harness.json'); console.log(h.ref, Object.keys(h.pages))"
node matching/harness.mjs --table
grep -c 'match-harness' .gitignore CLAUDE.md
```

Expected: `https://www.29navy.com [ 'home' ]`; one tab-separated row `home<TAB>/<TAB>/dev/match/home<TAB>` (anchors still empty); the marker appearing exactly once in each of `.gitignore` and `CLAUDE.md`.

- [ ] **Step 3: Write 29 Navy's marks into `harness.json` before the preflight is ever asserted on.** The recipe cannot know them, and the preflight's contract is "the body contains `refMark` and does not contain `candMark`" — with an empty `refMark`, `body.includes("")` is true for **any** body, so an `exit=0` would be granted by an empty string. Set three keys (leave `matrix` and `anchors` alone; Task 12 derives those):

```json
  "refMark": "data-wf-site=\"61411d5add9b561004cfbf8b\"",
  "candMark": "_app/immutable",
  "selfHosts": ["29-navy.netlify.app"],
```

`refMark` is the Webflow site id the reference stamps on `<html>`; `candMark` is the SvelteKit asset path no Webflow page emits. Commit them now so the branch the PR carries is the one that was tested:

```bash
cd ~/Documents/GitHub/29-navy
pnpm exec prettier --write matching/harness.json
git add matching/harness.json && git commit -m "$(cat <<'EOF'
matching: 29 Navy's reference and candidate marks

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Prove the preflight is armed, by breaking it two ways** — three runs, and all three are required. `git checkout matching/harness.json` restores the committed state after each edit.

| #   | Edit to `matching/harness.json`                    | `node matching/harness.mjs --check-ref; echo exit=$?` |
| --- | -------------------------------------------------- | ----------------------------------------------------- |
| 1   | `"refMark": ""`                                    | `exit=2`, refusing the empty mark                     |
| 2   | none (the committed state)                         | `exit=0`                                              |
| 3   | `"ref": "https://beachfront-dentistry.webflow.io"` | `exit=2`, naming the 404                              |

Run 1 is the one that matters and it is a **contract check on plan BC**: if it prints `exit=0`, the preflight is granting a pass on an empty string — the "green from the absence of an error" defect CLAUDE.md names — and the fix is a guard in the recipe's `harness.mjs` (refuse when `refMark` is empty or shorter than a few characters), landed in `reddoor-maintenance` before this task continues. Do not paper over it here. Run 2 alone proves only that the script ran; run 3 proves it can still fail on a dead host, which is how Beachfront's reference was found dead in the first place.

- [ ] **Step 5: Prove the dev guard on a production build**

```bash
pnpm build && pnpm preview &
sleep 5
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4173/dev/match/home       # expect 404
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4173/dev/a11y-fixtures    # expect 200 — the control
kill %1
```

Both numbers are required: a dead server returns nothing for both, and a 404 with no 200 control proves only that the server is down. Verify on the production build — `vite dev` actively hides this class. (`pnpm build` works plainly here because Task 3 Step 7 published `home`; if it fails with `404 /: Page not found`, that document is gone and Task 3 Step 7 must be re-checked before reading anything into these two numbers.)

- [ ] **Step 6: Push the recipe's branch and open the PR**

```bash
git push -u origin HEAD
gh pr create --repo reddoorla/29-navy --base main \
  --title "chore: install the match harness" \
  --body "$(cat <<'EOF'
`reddoor-maint match-harness ~/Documents/GitHub/29-navy --ref https://www.29navy.com`, plus one follow-up commit setting the three site marks (`refMark`, `candMark`, `selfHosts`) the recipe cannot know. Nothing else is edited.

Evidence, all three runs pasted below: `harness.mjs --check-ref` exits **2** with an empty `refMark` (so no pass can be granted by an empty string), exits **0** against the live reference, and exits **2** against a dead host. And `/dev/match/home` returns 404 on `pnpm build && pnpm preview` while `/dev/a11y-fixtures` returns 200 — the control that says the server was actually up.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Merge when CI is green (GREEN tier).

---

### Task 10: The reference capture script

**Files:** Create: `~/Documents/GitHub/29-navy/matching/capture-reference.mjs` · Test: the script's own count assertions, exercised by deliberate mutation

- [ ] **Step 1: Get onto a branch cut from the merged `main`.** Task 9 left `maint/match-harness-<ts>` checked out, and its PR was squash-merged — branching from it would re-contain every `matching/*` and `src/routes/dev/match/*` file the harness PR already landed, and Task 15's changed-file check would then be wrong. Batch branches come off `main` (project CLAUDE.md, "Branch per batch").

```bash
cd ~/Documents/GitHub/29-navy
git checkout main && git pull --ff-only
git log --oneline -1          # the squash commit of "chore: install the match harness"
git branch -D maint/match-harness-<ts>
git checkout -b docs/29navy-phase-0-1
git status --short            # expect NO output: matching/spec/ is git-ignored and the capture script does not exist yet
```

The `git log` line is the check: if it does not name the harness PR's squash commit, the merge did not land and Steps 2–4 would run against a `matching/harness.mjs` that is not on `main`.

- [ ] **Step 2: Write the capture script.** There is no vitest harness for `matching/*` and inventing one for a nine-minute script is not the honest gate; the gate is the script's own fail-closed assertions, and Step 3 proves them by breaking them. Write the file exactly as below, with `EXPECT.htmlAssets = 58`:

```js
#!/usr/bin/env node
/**
 * matching/capture-reference.mjs — Phase 0 reference capture (spec D11).
 *
 * Downloads the reference page and EVERY file it needs into matching/spec/,
 * preserving each URL's own filename and REWRITING NOTHING: the capture is the
 * authoritative source Phase 1 greps, and a rewritten href would make it lie
 * about what the reference actually loads.
 *
 * It fails loudly. A non-200 on any file, a filename collision, or a group
 * count that disagrees with EXPECT stops the run with exit 2 — a capture that
 * silently dropped a file is worse than no capture, because SPEC.md would then
 * cite a stylesheet that is missing rules and nothing would say so.
 *
 * Why this exists at all: on 2026-09-08, Beachfront's reference was found dead
 * on every host, mid-campaign. The client's live site does not outlive the
 * cutover.
 *
 * Run from the site root, redirecting to the tracked manifest:
 *   node matching/capture-reference.mjs > matching/CAPTURE.md; echo exit=$?
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { REF } from "./harness.mjs";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const OUT = "matching/spec";

/**
 * Measured against https://www.29navy.com/ on 2026-09-08, every URL fetched.
 * These are ASSERTIONS, not documentation. If the reference gains a slide or
 * drops a photo the run fails and the operator decides — rather than Phase 1
 * quietly speccing a different page than the one that was censused.
 *
 * `htmlAssets` counts <img src> plus every srcset variant: 58, not the 18 that
 * counting src alone gives. `fonts` is the three Font Awesome families in
 * woff2/eot/woff/ttf; `fontSvg` is their legacy .svg faces; the webflow-icons
 * face is a base64 data: URI and needs no file. `cssOther` is Webflow's
 * background-image.svg placeholder.
 */
const EXPECT = {
  html: 1,
  css: 1,
  scripts: 3,
  icons: 2,
  htmlAssets: 58,
  fonts: 12,
  fontSvg: 3,
  cssPhotos: 10,
  cssOther: 1,
  files: 90,
};

const FONT_EXT = /\.(?:woff2?|eot|ttf|otf)$/i;
const FA_SVG = /_fa-[a-z]+-\d+\.svg$/i;
const RASTER = /\.(?:jpe?g|png|gif|webp|avif)$/i;

/** Where each group lands. Anything unlisted goes to assets/. */
const DIRS = { html: ".", css: ".", scripts: "js", fonts: "fonts", fontSvg: "fonts" };
const DIR_ORDER = ["html", "css", "scripts", "fonts", "fontSvg"];

const die = (msg) => {
  console.error(`capture: ${msg}`);
  process.exit(2);
};

/** url -> Set(group). One URL can belong to two groups (location-aerial.jpg is
 *  both an <img> asset and a CSS background), so counts and downloads differ. */
const queue = new Map();
const add = (url, group) => queue.set(url, (queue.get(url) ?? new Set()).add(group));

async function get(url) {
  const res = await fetch(url, { headers: { "user-agent": UA } });
  return { status: res.status, buf: Buffer.from(await res.arrayBuffer()) };
}

const root = REF.endsWith("/") ? REF : `${REF}/`;
const page = await get(root);
if (page.status !== 200) die(`${root} returned ${page.status} — nothing captured`);
const html = page.buf.toString("utf8");
add(root, "html");

const abs = (u, base) => new URL(u, base).href;

// <link> attribute order on this reference is href-then-rel, so read the whole
// tag and pull both attributes out of it rather than assuming an order.
for (const m of html.matchAll(/<link\b[^>]*>/g)) {
  const href = /href="([^"]+)"/.exec(m[0])?.[1];
  const rel = (/rel="([^"]+)"/.exec(m[0])?.[1] ?? "").toLowerCase();
  if (!href) continue;
  if (rel.includes("stylesheet")) add(abs(href, root), "css");
  else if (rel.includes("icon")) add(abs(href, root), "icons"); // shortcut icon, apple-touch-icon
}
for (const m of html.matchAll(/<script\b[^>]+src="([^"]+)"/g)) add(abs(m[1], root), "scripts");
for (const m of html.matchAll(/<img\b[^>]+src="([^"]+)"/g)) add(abs(m[1], root), "htmlAssets");
for (const m of html.matchAll(/srcset="([^"]+)"/g)) {
  for (const part of m[1].split(",")) {
    const u = part.trim().split(/\s+/)[0];
    if (u) add(abs(u, root), "htmlAssets");
  }
}

// The stylesheet must be read before its own url()s can be queued, so it is
// fetched here rather than in the download loop below.
const sheets = [...queue].filter(([, g]) => g.has("css")).map(([u]) => u);
if (sheets.length !== EXPECT.css) die(`expected ${EXPECT.css} stylesheet, found ${sheets.length}`);
const sheet = await get(sheets[0]);
if (sheet.status !== 200) die(`stylesheet ${sheets[0]} returned ${sheet.status}`);

for (const m of sheet.buf.toString("utf8").matchAll(/url\(\s*(["']?)([^)"']+)\1\s*\)/g)) {
  const raw = m[2].trim();
  if (raw.startsWith("data:")) continue;
  const u = abs(raw, sheets[0]);
  const name = decodeURIComponent(basename(new URL(u).pathname));
  if (FONT_EXT.test(name)) add(u, "fonts");
  else if (FA_SVG.test(name)) add(u, "fontSvg");
  else if (RASTER.test(name)) add(u, "cssPhotos");
  else add(u, "cssOther");
}

const fetched = new Map([
  [root, page],
  [sheets[0], sheet],
]);
const claimed = new Map();
const rows = [];

for (const [url, groups] of queue) {
  const r = fetched.get(url) ?? (await get(url));
  const dir = DIRS[DIR_ORDER.find((g) => groups.has(g))] ?? "assets";
  const name = groups.has("html")
    ? "index.html"
    : decodeURIComponent(basename(new URL(url).pathname)) || "index.html";
  const path = join(OUT, dir, name);
  const owner = claimed.get(path);
  if (owner && owner !== url) die(`filename collision at ${path}: ${owner} and ${url}`);
  claimed.set(path, url);
  const label = [...groups].sort().join("+");
  if (r.status !== 200) {
    rows.push({ path, url, label, status: r.status, bytes: 0, sha: "-" });
    continue;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, r.buf);
  rows.push({
    path,
    url,
    label,
    status: r.status,
    bytes: r.buf.length,
    sha: createHash("sha256").update(r.buf).digest("hex").slice(0, 16),
  });
}

const counts = { files: queue.size };
for (const [, groups] of queue) for (const g of groups) counts[g] = (counts[g] ?? 0) + 1;

console.log(`# Reference capture — ${root}`);
console.log("");
console.log(`Captured ${new Date().toISOString()} by \`matching/capture-reference.mjs\`.`);
console.log("The bytes live in git-ignored `matching/spec/`; this manifest is tracked so a");
console.log("fresh clone can tell whether its capture is the same one SPEC.md was written from.");
console.log("");
console.log("| file | group | bytes | status | sha256:16 |");
console.log("| --- | --- | --- | --- | --- |");
for (const r of rows.sort((a, b) => a.path.localeCompare(b.path))) {
  console.log(`| \`${r.path}\` | ${r.label} | ${r.bytes} | ${r.status} | \`${r.sha}\` |`);
}
console.log("");
console.log(`Total ${rows.length} files, ${rows.reduce((n, r) => n + r.bytes, 0)} bytes.`);
console.log("");
console.log("| group | found | expected |");
console.log("| --- | --- | --- |");
for (const k of Object.keys(EXPECT)) console.log(`| ${k} | ${counts[k] ?? 0} | ${EXPECT[k]} |`);

const bad = rows.filter((r) => r.status !== 200);
if (bad.length) {
  die(
    `${bad.length} file(s) did not return 200: ` +
      bad.map((r) => `${r.status} ${r.url}`).join(", "),
  );
}
const wrong = Object.keys(EXPECT).filter((k) => (counts[k] ?? 0) !== EXPECT[k]);
if (wrong.length) {
  // Print the URLs, not just the delta. A count can move because the reference
  // changed OR because a classifier above mis-sorted a filename (FA_SVG assumes
  // Webflow's <hash>_fa-<family>-<weight>.svg shape, and anything unmatched
  // falls through to cssOther) — and "the reference moved" sends the operator
  // to inspect a page that did not. The URLs are what tells the two apart.
  for (const k of wrong) {
    const urls = rows.filter((r) => r.label.split("+").includes(k)).map((r) => r.url);
    console.error(`capture:   ${k} (${counts[k] ?? 0}, expected ${EXPECT[k]}):`);
    for (const u of urls) console.error(`capture:     ${u}`);
  }
  die(
    "group counts moved: " +
      wrong.map((k) => `${k} ${counts[k] ?? 0}≠${EXPECT[k]}`).join(", ") +
      " — either the reference changed or a classifier mis-sorted the URLs listed" +
      " above; check the group column in matching/CAPTURE.md before re-censusing",
  );
}
console.error("capture OK");
```

- [ ] **Step 3: Break it on purpose — two named mutations, two different failures.** Apply each, run, read the exit code, then revert it before the next. The run command is the same each time:

```bash
cd ~/Documents/GitHub/29-navy
node matching/capture-reference.mjs > /tmp/cap.md; echo exit=$?
```

**(i) A stylesheet that is not there.** In `matching/capture-reference.mjs`, replace

```js
const sheet = await get(sheets[0]);
```

with

```js
sheets[0] = sheets[0].replace(/[^/]+\.css$/, "nope.css");
const sheet = await get(sheets[0]);
```

Expect `exit=2` and, on stderr, `capture: stylesheet https://cdn.prod.website-files.com/61411d5add9b561004cfbf8b/css/nope.css returned 404` (any non-200 there is a pass — the assertion is on the refusal, not on Webflow's choice of status code). Then delete the line you added.

**(ii) A count that no longer matches.** Change `  htmlAssets: 58,` to `  htmlAssets: 57,`. Expect `exit=2`, the per-group URL listing, and the line `capture: group counts moved: htmlAssets 58≠57 — either the reference changed or a classifier mis-sorted the URLs listed above; check the group column in matching/CAPTURE.md before re-censusing`. Then change it back to `58`.

Two distinct failures from two distinct causes is what proves the assertions are wired to what they claim to measure. A script that has only ever been seen to pass has not been tested.

- [ ] **Step 4: Run it clean and watch it pass**

```bash
cd ~/Documents/GitHub/29-navy
node matching/capture-reference.mjs > matching/CAPTURE.md; echo exit=$?
```

Expected `exit=0` with `capture OK` on stderr. Capture the exit code explicitly — a pipe through `tail` eats it, which produced two false PASSes in this skill's history. The file is still untracked, so `git diff` proves nothing about the reverts; check them directly instead — `grep -c 'nope.css' matching/capture-reference.mjs` prints `0` and `grep -n 'htmlAssets:' matching/capture-reference.mjs` prints `htmlAssets: 58,`.

- [ ] **Step 5: Commit**

```bash
cd ~/Documents/GitHub/29-navy
pnpm exec prettier --write matching/
git add matching/capture-reference.mjs matching/CAPTURE.md
git commit -m "$(cat <<'EOF'
matching: capture the reference and everything it loads

The client's live site is the only copy of this design. Beachfront's died
mid-campaign; this one will die at cutover.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

`matching/` is prettier-checked by `pnpm lint` (`prettier --check .`, and `.prettierignore` does not exclude it), so format before committing.

---

### Task 11: Verify the capture, and record what the reference gets wrong

**Files:** Modify: `matching/LEDGER.md` · Create: an issue on `reddoorla/29-navy`

- [ ] **Step 1: Check the manifest against the measured shape**

```bash
cd ~/Documents/GitHub/29-navy
find matching/spec -type f | wc -l                       # 90
ls matching/spec/*.html matching/spec/*.css | wc -l      # 2
ls matching/spec/assets | wc -l                          # 70  (58 html + 2 icons + 10 css photos + 1 other, -1 shared)
ls matching/spec/fonts | wc -l                           # 15  (12 binary faces + 3 legacy .svg)
ls matching/spec/js | wc -l                              # 3
du -sh matching/spec                                     # ~14M
```

2 + 3 + 15 + 70 = 90. If `assets` differs from 70, read the manifest's `group` column: a URL in two groups is stored once and counted twice, which is exactly the `location-aerial.jpg` case (`htmlAssets+cssPhotos`) and the reason `files` is 90 and not 91.

- [ ] **Step 2: Prove the four floor-plan PDFs are dead on the live site**

```bash
for n in 1 2 3 4; do
  curl -sS -o /dev/null -w "%{http_code} %{size_download} https://29navy.com/pdf/file$n.pdf\n" \
    -A "Mozilla/5.0" "https://29navy.com/pdf/file$n.pdf"
done
```

Expected: four `404 906` lines. Repeat once against `https://www.29navy.com/pdf/file1.pdf` and once over `http://` — all 404, all the same 906-byte Webflow "not found" page. The PDFs are a **client deliverable**; the capture cannot recover them and they must never be redrawn or reconstructed.

- [ ] **Step 3: Record the reference's own defects in the ledger.** Append to `matching/LEDGER.md`:

```markdown
## Phase 0 — reference defects (2026-09-08)

Three things the live reference does that the rebuild must NOT reproduce. Each
was read out of the captured HTML, not inferred.

- [deviation] Floor-plan modals — all four "Download a PDF of this floor" links
  point at `https://29navy.com/pdf/file{1,2,3,4}.pdf`, and all four return 404
  (906-byte Webflow not-found) from the apex, from `www`, and over http. The
  download is broken on the client's live site today. The PDFs are a client
  deliverable; capture cannot recover them. Tracked as reddoorla/29-navy#<n>.
- [deviation] Contact/cable-tv phone link — `href="https://(310) 393-9653"`
  (matching/spec/index.html). An https URL containing a phone number: it
  resolves to nothing. The rebuild ships `tel:+13103939653`.
- [deviation] Email link — `href="mailto:29navy@worthe.com‍"`, with a
  trailing ZERO WIDTH JOINER (bytes `e2 80 8d`) inside the address. The rebuild
  ships the address without it.
- [a11y] All 23 `<img>` elements on the reference carry `alt=""`. The rebuild
  authors real alt text, so `text-diff`'s alt census will show residual rows in
  the candidate direction on every image. Pre-declared as artifact class 4
  ("deliberate a11y additions") — one row each, not a defect.
```

- [ ] **Step 4: Open the client-deliverable issue**

```bash
gh issue create --repo reddoorla/29-navy \
  --title "Floor-plan PDFs: all four 404 on the live site — client must supply the files" \
  --body "$(cat <<'EOF'
The four floor-plan modals each link to a PDF that does not exist:

| link | status |
| --- | --- |
| https://29navy.com/pdf/file1.pdf | 404 |
| https://29navy.com/pdf/file2.pdf | 404 |
| https://29navy.com/pdf/file3.pdf | 404 |
| https://29navy.com/pdf/file4.pdf | 404 |

Checked 2026-09-08 from the apex, from `www`, and over http — all four return the same 906-byte Webflow "not found" page through Cloudflare. The download link in every floor-plan modal is therefore broken on the client's live site today.

These are a **client deliverable**. The Phase 0 reference capture cannot recover them, and they must never be reconstructed or redrawn. The rebuild's floor-plan modals ship with the download link disabled until the real files arrive.

Ask the client for the four floor plans (1st, 2nd, 3rd, 4th/penthouse) as PDFs.
EOF
)"
```

- [ ] **Step 5: Commit the ledger** — replace the ledger's `reddoorla/29-navy#<n>` placeholder with the number Step 4 printed **first**, so the commit carries the real reference:

```bash
cd ~/Documents/GitHub/29-navy
grep -n 'reddoorla/29-navy#' matching/LEDGER.md          # must not print "#<n>"
pnpm exec prettier --write matching/
git add matching/LEDGER.md
git commit -m "$(cat <<'EOF'
matching: ledger the reference's three live defects and its empty alts

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Phase 0 calibration — matrix, root font, gutter, fonts

**Files:** Modify: `matching/harness.json` · Create: `matching/probe-calibrate.mjs`

- [ ] **Step 1: Derive the breakpoint matrix from the captured CSS, not from habit**

```bash
cd ~/Documents/GitHub/29-navy
grep -n '@media' matching/spec/29navy-8c2435.shared.46514381b.css
```

Expected exactly twelve lines. The site-authored blocks are the last three (`3116` ≤991, `3218` ≤767, `3396` ≤479); the earlier ones are Webflow's normalize and grid, including the single `(min-width: 768px)` at `1632` which is a `w-container` rule, not a site breakpoint. Ranges: **≥992**, **768–991**, **480–767**, **≤479** → representative viewports **1440, 991, 767, 390**. `1440,390` is the floor and would miss both middle bands; max-width blocks cascade downward, so the 480–767 value is often inherited from the ≤991 block rather than declared in a ≤767 one.

- [ ] **Step 2: Write the calibration probe** — `matching/probe-calibrate.mjs`:

```js
/**
 * matching/probe-calibrate.mjs — Phase 0 steps 3, 4, 7.
 * Root font-size, body clientWidth and the fonts census, on the reference and
 * (when it is running) the candidate, at every matrix viewport.
 * Run from the site root: node matching/probe-calibrate.mjs
 */
import { chromium } from "@playwright/test";
import { REF, CAND, MATRIX } from "./harness.mjs";

const FAMILIES = [
  ["Arial", 400],
  ["Helvetica Neue", 400],
  ["Fa solid 900", 400],
  ["Fa 400", 400],
  ["Fa brands 400", 400],
  ["webflow-icons", 400],
];

const b = await chromium.launch();
try {
  for (const [side, base] of [
    ["ref", REF],
    ["cand", CAND],
  ]) {
    for (const width of MATRIX) {
      const p = await b.newPage({ viewport: { width, height: 900 } });
      try {
        await p.goto(`${base}/`, { waitUntil: "networkidle", timeout: 60000 });
      } catch {
        console.log(`${side} ${width}: unreachable — skipped`);
        await p.close();
        continue;
      }
      const out = await p.evaluate(
        (fams) => ({
          root: getComputedStyle(document.documentElement).fontSize,
          bodyFont: getComputedStyle(document.body).font,
          clientWidth: document.body.clientWidth,
          fonts: fams.map(([f, w]) => `${f}/${w}=${document.fonts.check(`${w} 1em "${f}"`)}`),
        }),
        FAMILIES,
      );
      console.log(
        `${side} ${width}: root=${out.root} bodyWidth=${out.clientWidth} body=${out.bodyFont}`,
      );
      console.log(`  fonts: ${out.fonts.join(" ")}`);
      await p.close();
    }
  }
} finally {
  await b.close();
}
```

`try/finally` around `close()` is not optional — a thrown `evaluate` otherwise leaks a headless chromium, and enough of those starve the test runner.

- [ ] **Step 3: Run it and read the numbers**

```bash
pnpm exec playwright install chromium
node matching/probe-calibrate.mjs
```

Expected on the `ref` rows: `root=16px` at every viewport — **the reference does not scale its root**. The captured CSS has exactly two `html` rules (`:1-5` sets `-webkit-text-size-adjust` and `font-family: sans-serif`; `:218-220` sets `height: 100%`) and neither sets `font-size`. That is the opposite of Beachfront's 40px→24px ladder, and it means px values in this stylesheet are literal: matched values need no rem arithmetic. `body` is `#333` on `#fff`, `Arial, sans-serif`, `14px/20px` (`:222-230`). Paste the `fonts:` lines: the three Font Awesome faces must report `true` on the reference; a missing weight synthesizes silently and poisons both the style census and geometry.
The `cand` rows will report `unreachable` unless `pnpm dev` is up — that is fine at Phase 0 and must be said, not implied.

- [ ] **Step 4: Write the derived values into `harness.json`** — `refMark`, `candMark` and `selfHosts` already landed in Task 9 Step 3 (the preflight could not be asserted on without them); this step adds `matrix` (derived in Step 1) and `pages.home.anchors`, which Task 13 Step 4 then proves unique and in document order against the captured HTML. The whole file, for the avoidance of drift:

```json
{
  "ref": "https://www.29navy.com",
  "cand": "http://localhost:5173",
  "matrix": [1440, 991, 767, 390],
  "threshold": 0.1,
  "maxHeightDelta": 0.05,
  "refMark": "data-wf-site=\"61411d5add9b561004cfbf8b\"",
  "candMark": "_app/immutable",
  "selfHosts": ["29-navy.netlify.app"],
  "pages": {
    "home": {
      "uid": "home",
      "ref": "/",
      "cand": "/dev/match/home",
      "published": "/",
      "anchors": [
        "Creative Lofts",
        "Hover or click on a floor",
        "Paying rent online?",
        "29 Navy Street"
      ],
      "spec": "home",
      "group": "nav"
    }
  }
}
```

`selfHosts` deliberately does **not** list `29navy.com` / `www.29navy.com` yet — today those serve the reference. At DNS cutover they must be added, or the preflight will happily compare our build with itself, which is precisely what happened to Beachfront and went unnoticed in three tools. That is recorded in the ledger in Task 15.

- [ ] **Step 5: Verify and commit**

```bash
cd ~/Documents/GitHub/29-navy
node matching/harness.mjs --check-ref; echo exit=$?
node -e "import('./matching/harness.mjs').then(m=>console.log(m.MATRIX, JSON.stringify(m.TOTALS)))"
pnpm exec prettier --write matching/
git add matching/harness.json matching/probe-calibrate.mjs
git commit -m "$(cat <<'EOF'
matching: the matrix and fonts census, derived from the captured CSS

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: `exit=0`; then `[1440,991,767,390]` and a total of **20** for `home` — printed as `20` or as `{"home":20}` depending on which shape plan BC gave the export (Beachfront's `matching/next.mjs:31-40` keys it per page; the decided formula `(anchors.length+1)*MATRIX.length` is a scalar). Either is correct: 4 anchors + 1 region, times 4 viewports. A different **number** is not, and means the anchors or the matrix did not land.

---

### Task 13: Phase 0 — section census and interaction inventory

**Files:** Create: `matching/probe-inventory.mjs`

- [ ] **Step 1: Write the inventory probe** — the skill fixes the interaction count NOW so nothing is quietly skipped in Phase 5:

```js
/**
 * matching/probe-inventory.mjs — Phase 1's interaction inventory and section
 * census, read from the reference's own DOM at 1440.
 * Run from the site root: node matching/probe-inventory.mjs
 */
import { chromium } from "@playwright/test";
import { REF } from "./harness.mjs";

const b = await chromium.launch();
try {
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto(`${REF}/`, { waitUntil: "networkidle", timeout: 60000 });
  const out = await p.evaluate(() => {
    const rows = [];
    for (const el of document.querySelectorAll("[data-w-id]")) {
      const r = el.getBoundingClientRect();
      rows.push({
        wid: el.getAttribute("data-w-id"),
        tag: el.tagName.toLowerCase(),
        cls: el.className,
        text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40),
        y: Math.round(r.top + scrollY),
      });
    }
    const widgets = [...document.querySelectorAll(".w-slider, .w-nav")].map((el) => ({
      cls: el.className,
      slides: el.querySelectorAll(".w-slide").length,
    }));
    const hidden = [...document.querySelectorAll("div")]
      .filter((el) => getComputedStyle(el).display === "none" && el.className)
      .map((el) => el.className);
    return { rows, widgets, hidden };
  });
  console.log(`data-w-id triggers: ${out.rows.length}`);
  for (const r of out.rows) console.log(`  y=${r.y} ${r.tag}.${r.cls} "${r.text}"`);
  console.log(`widgets: ${JSON.stringify(out.widgets)}`);
  console.log(`display:none containers (${out.hidden.length}): ${out.hidden.join(" | ")}`);
} finally {
  await b.close();
}
```

- [ ] **Step 2: Run it** — `node matching/probe-inventory.mjs`. Expected: **18** `data-w-id` triggers, one `.w-slider` with **6** `.w-slide` children, one `.w-nav`, and ten `display:none` modal containers (`second-floor-modal`, `_3rd-floor-modal`, `_4th-floor-modal`, `_1st-floor-modal`, `popup-modal---electric`, and the laundry/gym/tv-internet/ride/food variants). If the trigger count is not 18, stop and re-census — the number is the Phase 5 denominator.
- [ ] **Step 3: Read the reference's own scripts for what those triggers do** — the Webflow interactions live in the page chunk, not in the DOM:

```bash
cd ~/Documents/GitHub/29-navy
node -e "
const fs=require('fs');
const js=fs.readdirSync('matching/spec/js').map(f=>fs.readFileSync('matching/spec/js/'+f,'utf8')).join('\n');
const ids=[...new Set([...js.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g)].map(m=>m[0]))];
console.log('interaction ids in the chunks:', ids.length);
"
```

Cross-reference the `data-w-id` values from Step 2 against these. The scripts are the authoritative spec for what triggers what, with what timing and easing — a screenshot is not.

- [ ] **Step 4: Confirm the anchors resolve in document order on the reference** — the census's hardest constraint here is that almost every heading collides with a nav link. The reference has three `<h1>`s — `Location`, `Residents`, `Contact` — and the navbar carries `Location`, `Lofts`, `Residents`, `Contact` links **earlier in document order**, so anchoring on any of them cuts at the nav and puts the anchors out of order. Prove the four chosen anchors are unique and ordered:

```bash
node -e "
const fs=require('fs');
const t=fs.readFileSync('matching/spec/index.html','utf8')
  .replace(/<script[\s\S]*?<\/script>/g,'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');
for (const a of ['Creative Lofts','Hover or click on a floor','Paying rent online?','29 Navy Street']) {
  const n = t.split(a).length - 1;
  console.log(a, '->', n, 'occurrence(s) at index', t.indexOf(a));
}
"
```

Expected: each anchor occurs exactly **once**, with strictly increasing indices. `Location` deliberately gets no anchor: its band merges into the `Creative Lofts` region, which is therefore a composite (hero + mobile-location image + Location band) — declare that in `SPEC.md` and the ledger rather than deleting the census section.

- [ ] **Step 5: Commit**

```bash
cd ~/Documents/GitHub/29-navy
pnpm exec prettier --write matching/
git add matching/probe-inventory.mjs
git commit -m "$(cat <<'EOF'
matching: interaction inventory — 18 triggers, one slider, one nav

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: Phase 1 — `spec-sections/home.md` and `SPEC.md`

**Files:** Create: `matching/spec-sections/home.md` · Modify: `matching/spec-sections/_header.md` · Generated: `matching/SPEC.md`

- [ ] **Step 1: Write the site header prose** — `matching/spec-sections/_header.md` replaces the recipe's template with 29 Navy's standing facts. Every number cites a line of the captured stylesheet (`matching/spec/29navy-8c2435.shared.46514381b.css`, 3,530 lines, 61,786 bytes):

```markdown
Reference: `https://www.29navy.com/`, Webflow site `61411d5add9b561004cfbf8b`,
page `61411d5add9b56e648cfbf8c`, "Last Published: Thu Nov 06 2025 00:21:41 GMT".
Captured 2026-09-08 into `matching/spec/` — see `matching/CAPTURE.md` for the
90-file manifest and per-file sha256.

**Root font-size is 16px at every viewport.** The stylesheet declares two `html`
rules (`:1-5`, `:218-220`) and neither sets `font-size`. Px values in this
stylesheet are literal — no rem ladder, unlike Beachfront.

`body` (`:222-230`): `#333` on `#fff`, `Arial, sans-serif`, `14px/20px`,
`margin: 0`, `min-height: 100%`.

Theme (`:root`, `:2073-2078`): `--white: white`, `--firebrick: #aa4133`,
`--black: black`, `--white-2: #ffffff78`.

Fonts: system stack plus three self-hosted Font Awesome faces —
`"Fa solid 900"` (`@font-face` at `:2049`), `"Fa 400"` (`:2057`),
`"Fa brands 400"` (`:2065`), each 400/normal/`font-display: swap`, each with
five `src` formats. A fourth face, `webflow-icons` (`:171`), is a base64
`data:` URI and needs no file. No web-font kit, no licensing dependency.

Breakpoints: the site-authored blocks are `@media (max-width: 991px)` (`:3116`),
`(max-width: 767px)` (`:3218`) and `(max-width: 479px)` (`:3396`). The single
`(min-width: 768px)` at `:1632` is a Webflow `w-container` rule, not a site
breakpoint. Matrix: **1440 / 991 / 767 / 390**. Max-width blocks cascade
downward — read the whole cascade for a property before assuming the nearest
breakpoint owns it.
```

- [ ] **Step 2: Write the section census and per-section spec** — `matching/spec-sections/home.md`, opening with the heading `build-spec.mjs` and `gate.sh` both match (`^##+ +home`):

```markdown
## home — the single page (`/`)

### Section census (6 sections + shared chrome)

| #   | section                                                                                                          | anchor                           | source           |
| --- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------- | ---------------- |
| —   | chrome — `.navbar` `.w-nav`, 6 links (Location, Lofts, Residents, Contact, Apply Now, Pay Rent) + `.menu-button` | none — lives in the `top` region | index.html       |
| 1   | hero slider — `.section-2` / `.slider`, 6 `.w-slide`, logo + "Creative Lofts for Lease"                          | `Creative Lofts`                 | css `:2197-2208` |
| 2   | mobile location image — `.mobile-location`                                                                       | none — inside region 1           | css `:2878`      |
| 3   | Location band — `.section`, 100vh, `location-aerial.jpg` cover                                                   | none — see the collision note    | css `:2171-2177` |
| 4   | Lofts — `.section-4`, `#aa4133`, flex, `padding: 40px 20px 60px`, four floor triggers                            | `Hover or click on a floor`      | css `:2277-2285` |
| 5   | Residents — `.section-5`, white, `40px` block padding, two columns                                               | `Paying rent online?`            | css `:2341-2345` |
| 6   | Contact — `.section-7`, flex, address/phone/email/Zillow                                                         | `29 Navy Street`                 | css `:2451-2453` |

**Anchor collision note.** Three of the four visible `<h1>`s (`Location`,
`Residents`, `Contact`) and the Lofts label are byte-identical to nav links that
appear EARLIER in document order, and the cut lands on the first
document-order element whose collapsed text starts with the anchor. Anchoring on
any of them would cut at the navbar and put the anchors out of order — the
silent region-misalignment trap. Sections 1–3 therefore share one composite
region: the fix for a region that will not move is to change instruments
(element-level `report.json` CSS dump), never to add anchors that collide.

### Interaction inventory — 20 entries (Phase 5 verifies exactly 20)

- 18 `data-w-id` click-to-modal triggers (4 floor + 6 amenity opens, plus their
  closes/overlays), enumerated in the `probe-inventory.mjs` run pasted below.
- 1 `.w-slider` — 6 slides, prev/next arrows, dot nav.
- 1 `.w-nav` — mobile menu, `.menu-button` / `.w-icon-nav-menu`.

Ten modal containers are `display: none` at rest (`.popup-modal---electric`
`:2468-2474`, `.second-floor-modal` `:3062-3066`, and their eight siblings), so
neither `text-diff` nor `page-diff` can see any of their content. Everything
behind those clicks is Phase 5's alone.

### Assets

23 `<img>` in the HTML, 58 unique URLs with srcset variants, 10 photos reached
only through CSS `url()`, all 200 (`matching/CAPTURE.md`). **Ship the captured
files.** Never redraw the logo, the Font Awesome glyphs or any photo in CSS.

Every one of the 23 images carries `alt=""` on the reference. The rebuild
authors real alt text; the resulting `text-diff` rows are pre-declared artifact
class 4.

### Outbound links (verbatim from the capture)

`rentspree.com/apply/615b8194b7272a0016c60303/...`, `payments.gozego.com`,
`rinse.com/getwashio`, `goldsgym.com/veniceca`, `classpass.com`,
`fios.verizon.com`, `lyft.com`, `uber.com`, `postmates.com/los-angeles`,
`ubereats.com/eats/la`, `zillow.com/apartments/venice-ca/29-navy-creative-lofts/ChqQtg/`,
and the four dead `29navy.com/pdf/file{1..4}.pdf`. Two are malformed on the
reference and are corrected in the rebuild — see `LEDGER.md` Phase 0.
```

Fill the per-section typography, box structure, button/pill and `:hover` detail by probing each section against the captured CSS, exactly as the skill's Phase 1 prescribes — `grep ':hover' matching/spec/*.css` per section; if you did not grep it, you do not know it.

- [ ] **Step 3: Watch the gate refuse, while `SPEC.md` does not yet exist.** This has to happen _before_ the file is generated — once it exists the refusal can never be reproduced without deleting it again, and a gate that has never been seen to refuse is not evidence that it can.

```bash
cd ~/Documents/GitHub/29-navy
bash matching/gate.sh smoke home; echo exit=$?
```

Expected: `exit=2`, with `REFUSED: no '## home' section in matching/SPEC.md` (Beachfront's `matching/gate.sh:89-93` sets `FAILED_PREFLIGHT=1` and `:138-144` exits 2 on it). `smoke` is a legal round tag — `gate.sh:50-57` rejects only tags containing a hyphen, because `out-<TAG>-<page>` is split on the first one.

- [ ] **Step 4: Generate `SPEC.md`** — `node matching/build-spec.mjs`, which concatenates `_header.md`, `_chrome.md` and every `<page>.md` in `harness.json`'s page order. Verify with `grep -c '^## home' matching/SPEC.md` → `1`.
- [ ] **Step 5: Run the same command again and watch the refusal turn into a real run**

```bash
bash matching/gate.sh smoke home; echo exit=$?
```

Expected now, with no dev server running: the gate prints `########## home ##########` and then fails non-zero **inside `page-diff`**, unable to reach `http://localhost:5173` — **not** exit 2 from the preflight, because the reference is alive and `refMark` matches. Paste both this output and Step 3's; the pair is the evidence that the gate's refusal is keyed to the spec and not to something else.

- [ ] **Step 6: Commit**

```bash
cd ~/Documents/GitHub/29-navy
pnpm exec prettier --write matching/
git add matching/spec-sections/ matching/SPEC.md
git commit -m "$(cat <<'EOF'
matching: Phase 1 spec for home, every value cited to the captured CSS

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: Ledger, journal, PR, and the hand-off

**Files:** Modify: `matching/LEDGER.md` · Create: `~/Documents/GitHub/29-navy/docs/workJournal.md` (the maintenance journal entry is **not** here — it landed in Task 6 Step 4, in the worktree that carried the change it describes)

- [ ] **Step 1: The ledger's Phase 0 close-out** — append to `matching/LEDGER.md`:

```markdown
## Phase 0 — calibration complete (2026-09-08)

- Matrix **1440 / 991 / 767 / 390**, derived from the three site-authored
  `@media` blocks in the captured stylesheet (`:3116`, `:3218`, `:3396`). The
  `(min-width: 768px)` block at `:1632` is Webflow's `w-container` rule and is
  NOT a site breakpoint. `1440,390` would have missed two whole bands.
- Root font-size **16px at every viewport** — no ladder. Two `html` rules
  exist and neither sets `font-size`.
- Fonts census clean: `Fa solid 900`, `Fa 400`, `Fa brands 400` all report
  `document.fonts.check` true on the reference; no kit, no licensing block.
- Reference captured: 90 files, ~13.7 MB, every one 200. Manifest with sha256
  in `matching/CAPTURE.md` (tracked); the bytes are in git-ignored
  `matching/spec/` and exist **only on this machine**. Committing them, or
  serving them as a local reference, is the follow-up issue
  (`match-harness: captured-reference mode`).
- [ACK-REQUIRED at cutover] `selfHosts` lists only `29-navy.netlify.app`.
  `29navy.com` and `www.29navy.com` serve the REFERENCE today and must be added
  to `selfHosts` the moment DNS moves — otherwise the preflight passes while
  comparing our build with itself, which is exactly what happened to Beachfront
  and went unnoticed in three separate tools for a month.
- Composite region declared: sections 1–3 (hero + mobile-location + Location
  band) share the `Creative Lofts` region because every candidate anchor for the
  Location band collides with an earlier nav link. TOTALS.home = 20
  (4 anchors + 1, times 4 viewports).
```

- [ ] **Step 2: The new repo's first journal entry** — create `docs/workJournal.md` in `29-navy`:

```markdown
# Work journal

## 2026-09-08 — Bootstrapped, and the reference captured before it could die (`docs/29navy-phase-0-1`)

29 Navy is the first site built by the Webflow rebuild pipeline
(reddoor-maintenance `docs/superpowers/specs/2026-09-08-webflow-rebuild-pipeline-design.md`),
and the first native site whose model delivery exists on day one rather than
being retrofitted: `prismic-ci` ran positionally against this checkout and its
PR landed before a single slice was written. VLF, the site before this one,
accumulated fourteen merged model PRs and zero CI deliveries, and its models
were pushed by hand with an `.env` token.

The reason the capture came before anything else is the day's most expensive
discovery, and it belongs to another project. On the morning of the same day,
Beachfront's reference was found dead on every host — `beachfront-dentistry.webflow.io`
404s on every path, and `www.beachfrontdentistry.com` 301s to our own Netlify
build — which means three of its tools had been comparing the candidate with
itself, and its paused matching campaign can never be resumed against a live
reference. So `matching/capture-reference.mjs` ran on day one here: 90 files,
~13.7 MB, every one 200, sha256 per file in the tracked `matching/CAPTURE.md`.
The bytes are git-ignored and exist only on this machine, which is a known,
recorded risk, not an oversight.

What the reference turned out to be, measured rather than assumed: 58 unique
asset URLs once srcset variants are counted, not the 18 that `<img src>` alone
gives; 12 Font Awesome font files plus three legacy `.svg` faces, all
self-hosted; 10 photos reachable only through CSS `url()`; and a `webflow-icons`
face that is a base64 data URI and needs no file at all. **All four floor-plan
PDFs are 404** — from the apex, from `www`, and over http — so the download link
in every floor-plan modal is broken on the client's live site today. They are a
client deliverable and cannot be captured; issue #1 asks for them. Two more
live defects went in the ledger: a phone "link" authored as
`https://(310) 393-9653`, and a `mailto:` whose address ends in a zero-width
joiner. All 23 images carry `alt=""`, so the rebuild's real alt text is
pre-declared as a text-diff artifact class rather than discovered as a surprise.

One belief corrected on contact. The habit from Beachfront was to expect a
scaled root font-size (40px stepping to 24px) and to express everything
responsively because of it. This stylesheet has two `html` rules and neither
sets `font-size`: the root is 16px at every viewport, so its px values are
literal. Carrying Beachfront's rem arithmetic here would have been wrong in a
way that looks right at 1440.

The matrix is 1440 / 991 / 767 / 390, from the three site-authored `@media`
blocks. The `(min-width: 768px)` block in the same file is Webflow's
`w-container` rule, not a breakpoint — reading it as one would have added a
fifth viewport measuring nothing.

Phase 1's hardest constraint was anchors. Three of the four visible headings are
byte-identical to nav links that appear earlier in document order, and the
`page-diff` cut lands on the first match, so anchoring on them would have put
the anchors out of order and silently misaligned every region. Four unique
anchors survive; the Location band has none and is declared as part of a
composite region instead of being deleted from the census.

One thing was built that the plan did not originally intend, and it is worth
naming because the reasoning is not visible in the diff. Replacing the
`your-prismic-repo-name` sentinel against an EMPTY Prismic repository does not
merely turn the home route into a 404 — it fails the build. `entries()` makes
`/` a prerender entry as soon as the repository name is real, `page-load.ts`
turns Prismic's miss into a 404, and `svelte.config.js` rethrows a prerender 404
unless the sentinel is still in place. So `pnpm build` and CI would have been red
from the bootstrap commit onward; and because `self-updating` requires the
`ci / ci` context once it has been OBSERVED — by name, whatever its conclusion —
that red would have made every subsequent PR in this plan unmergeable without an
`--admin` merge. The fix was one operator write: push the repo's own `page` type
and publish a stub `home` document. Both are placeholders the slice session
overwrites. The belief that "the sentinel replacement only re-arms loud-fail
prerendering" was the thing that turned out to be too small.

Not done, deliberately: no slices, no real content, no seed. The
`prismic-models` workflow is installed with its secret present and **zero runs**
— which proves nothing until the first model PR, and the journal should not
pretend otherwise. The stub `page` type reached Prismic through Slice Machine,
not through that workflow, so it is not evidence of delivery either.
```

- [ ] **Step 3: Open the Phase 0/1 PR**

```bash
cd ~/Documents/GitHub/29-navy
pnpm exec prettier --write . && pnpm lint
git add -A && git commit -m "$(cat <<'EOF'
docs: Phase 0 calibration and the Phase 1 spec for home

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
git push -u origin docs/29navy-phase-0-1
gh pr create --repo reddoorla/29-navy --base main \
  --title "docs: reference capture, Phase 0 calibration, Phase 1 spec" \
  --body "$(cat <<'EOF'
The reference captured with every file it loads (90 files, all 200, sha256 per file in `matching/CAPTURE.md`), the breakpoint matrix and fonts census derived from that capture, and `SPEC.md` for the one page.

Three defects on the client's live site are in `matching/LEDGER.md` and #1: four 404 floor-plan PDFs, a phone link authored as an https URL, and a mailto ending in a zero-width joiner.

No slices, no Prismic documents, no seed — those are the next session.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Merge when CI is green** — `gh pr checks <n> --repo reddoorla/29-navy --watch`, then confirm the changed-file list with `gh pr view <n> --repo reddoorla/29-navy --json files --jq '.files[].path'`: it must be only `matching/*` and `docs/workJournal.md`. If `src/routes/dev/match/*` or `src/lib/site-pages.*` appear, the branch was cut from the un-squashed harness branch rather than from `main` — go back to Task 10 Step 1 and rebase onto `main` rather than merging a PR that re-lands files already on it. Then `gh pr merge <n> --squash --delete-branch`. GREEN tier.

---

## Verification

Run all of these from `~/Documents/GitHub/29-navy` unless stated. Each expects a positive artefact; none passes on an absent error.

| #   | Command                                                                                                                                     | Expected artefact                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `gh repo view reddoorla/29-navy --json name,visibility,defaultBranchRef`                                                                    | `29-navy`, `PUBLIC`, `main`                                                                                                                                  |
| 2   | `gh api repos/reddoorla/29-navy/rulesets --jq '.[].name'`                                                                                   | the canonical ruleset by name                                                                                                                                |
| 3   | `node -p "require('./slicemachine.config.json').repositoryName"`                                                                            | `29-navy` (not the sentinel)                                                                                                                                 |
| 4   | `gh secret list -R reddoorla/29-navy`                                                                                                       | a `PRISMIC_WRITE_TOKEN` row                                                                                                                                  |
| 5   | `gh secret list -R reddoorla/reddoor-maintenance \| grep 29_NAVY`                                                                           | one `PRISMIC_TOKEN_29_NAVY` row                                                                                                                              |
| 6   | `gh workflow list -R reddoorla/29-navy`                                                                                                     | `ci`, `renovate`, `prismic-models` — all `active`                                                                                                            |
| 7   | `grep -n PRISMIC_TOKEN_29_NAVY ~/Documents/GitHub/reddoor-maintenance/.github/workflows/fleet-prismic-drift.yml`                            | one line, above `PRISMIC_TOKEN_48BB12D1`                                                                                                                     |
| 8   | `readlink ~/.claude/skills/matching-a-page`                                                                                                 | a path inside the `claude-skills` clone                                                                                                                      |
| 9   | `node matching/harness.mjs --check-ref; echo exit=$?`                                                                                       | `exit=0`; `exit=2` with `refMark` emptied; `exit=2` with `ref` pointed at a dead host — all three, per Task 9 Step 4                                         |
| 10  | `node -e "import('./matching/harness.mjs').then(m=>console.log(m.MATRIX,JSON.stringify(m.TOTALS)))"`                                        | `[1440,991,767,390]` and a total of `20` for `home` — as `20` or `{"home":20}`, depending on BC's export shape; either is correct, a different number is not |
| 11  | `node matching/capture-reference.mjs > /dev/null; echo exit=$?`                                                                             | `exit=0`, `capture OK` on stderr                                                                                                                             |
| 12  | `find matching/spec -type f \| wc -l`                                                                                                       | `90`, equal to the manifest's `files` row                                                                                                                    |
| 13  | `ls matching/spec/fonts \| wc -l`                                                                                                           | `15`                                                                                                                                                         |
| 14  | `for n in 1 2 3 4; do curl -so /dev/null -w "%{http_code}\n" https://29navy.com/pdf/file$n.pdf; done`                                       | four `404`s, matching issue #1                                                                                                                               |
| 15  | `grep -c '^## home' matching/SPEC.md`                                                                                                       | `1`                                                                                                                                                          |
| 16  | `bash matching/gate.sh smoke home; echo exit=$?`                                                                                            | reaches `page-diff` (fails on the absent dev server), **not** exit 2 at the preflight                                                                        |
| 17  | `pnpm build && pnpm preview` then `curl -so /dev/null -w "%{http_code}\n" http://localhost:4173/dev/match/home` and `.../dev/a11y-fixtures` | `404` and `200` — both required. `pnpm build` itself succeeding is part of the artefact: it can only succeed because the `home` document is published        |
| 18  | `pnpm verify`                                                                                                                               | green throughout, smoke included (`/` → 200). A build failure naming `404 /: Page not found` is the unpublished-document state, not a matching problem       |
| 18b | `node -p "require('./slicemachine.config.json').repositoryName"` then `test -f build/index.html && echo prerendered`                        | `29-navy`, then `prerendered` — the pair, not either alone: a real repository name AND a home page that only prerenders because Prismic answered             |
| 19  | `gh issue list -R reddoorla/29-navy`                                                                                                        | the floor-plan PDF issue                                                                                                                                     |
| 20  | `git -C ~/Documents/GitHub/29-navy log --oneline main \| head -5`                                                                           | the bootstrap commit plus three merged PRs                                                                                                                   |

---

## STOP — the state to leave behind for the slice session

Stop after Task 15. Do **not** start slices, do not model any further custom types, do not run `prismic-seed`. The next session opens with:

1. **A repo that builds and delivers models.** `reddoorla/29-navy` on `main`, protected, CI green, `prismic-models.yml` installed and active with **zero runs** — its first run is the slice session's first model PR, and that run is the evidence, not the install.
   Prismic `29-navy` holds exactly two things, both from Task 3 Step 7 and both placeholders: the `page` custom type pushed from `customtypes/page/index.json`, and one published `page` document with uid `home`, title `29 Navy`, no slices. They exist because with a real `repositoryName` and an empty repository `pnpm build` fails at prerender (`svelte.config.js:34-36`), which would have made CI red and — via the ruleset's required `ci / ci` — every later PR unmergeable. The slice session overwrites both; it should not treat the stub's shape as a decision.
2. **`matching/spec/` on this machine**: 90 files, ~13.7 MB, manifest and sha256 in the tracked `matching/CAPTURE.md`. Re-run `node matching/capture-reference.mjs` at close-out; a changed sha256 on `index.html` means the reference moved mid-project and must be flagged.
3. **`matching/harness.json`** with the derived matrix `[1440, 991, 767, 390]`, the four anchors, and `pages.home.cand = /dev/match/home`. The twin route exists, is dev-guarded and 404s on a production build.
4. **`matching/SPEC.md`** — a 6-section census, 20-entry interaction inventory, and per-section values cited to the captured stylesheet's line numbers.
5. **Three open decisions the slice session must make, all recorded in the ledger, none of them guessable from the code:**
   - The four floor-plan PDFs are 404 on the live site (issue #1). Ship the modals with the download disabled until the client supplies them; never reconstruct them.
   - Font Awesome: the reference self-hosts three faces for a handful of glyphs. Decide whether to ship the captured `.woff2` faces or substitute the starter's Lucide icons, and ledger the choice — it is a visible-fidelity trade, not a detail.
   - `selfHosts` must gain `29navy.com` and `www.29navy.com` at DNS cutover, or the preflight will compare the build with itself.
6. **A journal entry in `docs/workJournal.md`** that says all of the above, including what is _not_ done.

The build shape the spec expects, for orientation only: one `page` document (`home`) with roughly five site slices (HeroSlider, LocationBand, FloorPlans, AmenityModals, ContactBand), chrome from `siteConfig`, images shipped as real files from the capture, modals as native `<dialog>` through the starter's `src/lib/components/Modal.svelte`, and the hero through `src/lib/components/Slider.svelte`. No collections, no importer, no content relationships — 29 Navy has no lists.

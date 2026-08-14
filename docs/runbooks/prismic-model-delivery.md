# Runbook — Prismic model delivery (headless, through CI)

**Goal:** a Prismic custom-type or slice-model change rides a normal pull request. The PR check posts the model delta as a comment, merging to `main` pushes those models to Prismic through that site's own workflow, and a nightly read-only sweep alarms on anything that diverged out of band. Nobody opens Slice Machine to _deliver_ a schema change.

The classification lives in [`AUTONOMY.md`](../../AUTONOMY.md): the CI push on a merged PR is 🟢, model **deletes** are 🔴, any fleet-wide model push outside a site's own CI is 🔴, and minting or rotating a write token is 🔴 like every other secret in this repo.

---

## 1. How a model change ships

1. Edit `customtypes/<id>/index.json` (custom types) or `<slice library>/<Dir>/model.json` (slices — the library path is read from each repo's `slicemachine.config.json`, fleet-uniform at `./src/lib/slices` but never assumed).
2. Open a PR. The site's `.github/workflows/prismic-models.yml` calls the reusable workflow, whose `dry` job runs `reddoor-maint prismic-models --comment-file prismic-models.txt` and posts the report as a PR comment. That job **cannot** write: it never passes `--apply`, and it holds no step that would.
3. Merge. The `apply` job runs on `push` to `refs/heads/main` only and pushes the models. It creates and updates; it never deletes. A model that exists only in Prismic is reported, never touched.

Authoring in Slice Machine locally is fine — commit what it writes. **Do not click Push in Slice Machine.** The nightly drift check is what catches it if somebody does.

### The comment is the review artifact

The comment step runs `if: always()`, deliberately: a dry run exits non-zero on a dead token, an unreadable Prismic repository, or a report whose own inputs disagree — exactly the PRs where "no comment appeared" is worst. If the CLI dies before writing its report at all, the step posts a `⛔ NO REPORT` comment and fails, rather than letting a stale file from a re-used workspace read as a fresh, passing one.

A repo with no Prismic in it gets a short "not a Prismic site" comment and a green check. That is not suppressed on purpose — a second answer to "is this a Prismic site" living in YAML could disagree with `readPrismicConfig`, and the day it did, a real site's model PR would silently lose its review comment.

### What a red PR check means

Every exit from the command is a verdict somebody acts on, so "I could not read X" never exits 0. The six that bite:

| Symptom                                          | Exit | Means                                                                                                             |
| ------------------------------------------------ | ---- | ----------------------------------------------------------------------------------------------------------------- |
| checkout unreadable / `.git` but no working tree | 1    | a typo'd path or a killed clone — **not** "no Prismic here"                                                       |
| no config file at all                            | 0    | a genuine skip; the reusable workflow legitimately runs on repos with no Prismic                                  |
| config present and broken                        | 1    | names the file. Never the skip above.                                                                             |
| local models unreadable                          | 1    | names the file. Never "this repo declares no models" — under `--apply` that would push from a half-read checkout. |
| remote unreadable                                | 1    | quotes the API error. Never an empty remote, which would sort every local model into `toCreate` and push the lot. |

---

## 2. What this pipeline will NOT deliver: a pure field reorder

`canon()` sorts object keys before comparing, because Prismic hands its copy back through its own serializer and key order there means nothing. The consequence is exact and worth stating plainly:

> **Reordering fields inside a custom type or a slice model is invisible to the diff.** The PR comment will say the site is in sync, and nothing will be pushed.

Object keys only. Array order is preserved (`canon` maps arrays, it does not sort them), so reordering `variations` or `thumbnails` entries _does_ diff and _does_ deliver.

This is not new behaviour to work around — Slice Machine had the same blindness: a pure key reorder staged nothing there either, which is why the old workaround was to pair it with a semantic tweak. Two ways to land a reorder:

- **Pair it with a semantic change** (a placeholder or label edit is enough). The diff is blind to order, but the _push_ is not: `sendModel` sends the model file's JSON verbatim, so once anything makes the model differ, the whole body — in its new order — goes to Prismic.
- **Reorder in the Prismic dashboard, then pull it back**: `reddoor-maint prismic-models <site> --pull`, review the diff in the working tree, and land it as an ordinary PR. Slower, but it is the option that leaves the repo and Prismic provably identical.

---

## 3. Minting a write token

Prismic dashboard → the repository → Settings → API & Security → create a **write token** for the Custom Types API. Two things it is not: not a content/document API token, and not the `PRISMIC_TOKEN` the Prismic CLI uses — that one is an undocumented _user session_ token that cannot bootstrap CI auth and never refreshes from the environment.

The token is sent as `Authorization: Bearer <token>` plus a `repository: <repositoryName>` header against `https://customtypes.prismic.io`.

**Expiry is undocumented.** Nobody knows whether these tokens expire, so the design assumes they can: an expired token surfaces as a repo that suddenly fails to READ, which the nightly writes as an `unknown` verdict and the digest raises as "Prismic model check could not run" — deliberately different wording from drift, because a dead secret sends you to fix a secret, not a model.

### The names come from the Prismic repository, not the repo directory

The central sweep needs one `PRISMIC_TOKEN_<PRISMIC REPOSITORY NAME>` per Prismic repository, upper-snaked. Fifteen of them today. Four do not match their GitHub repo's name, and they are exactly the four a list written from repo names gets wrong:

| GitHub repo                  | Prismic repository   | Secret                             |
| ---------------------------- | -------------------- | ---------------------------------- |
| `medical-solutions-of-texas` | `msot`               | `PRISMIC_TOKEN_MSOT`               |
| `reddoor-website`            | `reddoor-la`         | `PRISMIC_TOKEN_REDDOOR_LA`         |
| `data-dynamiq`               | `reddoor-wireframer` | `PRISMIC_TOKEN_REDDOOR_WIREFRAMER` |
| `beachfront-dentistry`       | `48bb12d1`           | `PRISMIC_TOKEN_48BB12D1`           |

The last one is a hash, not a name. An early draft of the nightly hardcoded `PRISMIC_TOKEN_MEDICAL_SOLUTIONS_OF_TEXAS` and omitted the other three; those secrets would never have resolved, four live sites would have reported MISSING, and the failure would have looked like a credentials problem rather than a naming one.

**Never hand-write the list.** The authority is:

```bash
reddoor-maint prismic-models --fleet airtable --tokens
```

It prints one row per site — repo, Prismic repository, the exact env var, and a verdict — derived from each site's own config. It is read-only, it never calls Prismic, and it never prints a token value.

Read the verdicts precisely:

- **`MISSING — mint this secret`** — the environment variable is unset or blank.
- **`PRESENT (not verified)`** — exactly that, and no more. Nothing has exercised this token against the API; the doctor reads the environment for emptiness only. To find out whether a token actually works, run `reddoor-maint prismic-models <site>` in the site, which performs a real read.
- **`CANNOT TELL — …`** — this checkout could not be read. **Not** a site without Prismic; nothing was established about its secret at all.
- **`no Prismic config (skipped)`** — this site needs no token.

The renderer also has `OK` and `PRESENT BUT 403/FAILED` states, but no current code path produces them: every probe sets `reads: null`. Treat them as reserved until something verifies tokens against the API.

Two refusals in the doctor are load-bearing and should be read as findings, not noise: an inventory that resolved nobody is refused rather than printed as an empty (finished-looking) checklist, and a run in which not one site's requirement was established is refused outright — "every site says it has no Prismic config" is what an emptied set of checkouts looks like, and it prints as a confident "this fleet needs no secrets at all".

---

## 4. Distributing tokens — 🔴, operator only

Two destinations, two names, both deliberate:

- **Per site repo**, for that repo's own delivery workflow:
  `gh secret set PRISMIC_WRITE_TOKEN --repo reddoorla/<repo>` — the generic name every site's code already reads, and what the reusable workflow declares as a required secret.
- **Central**, for the nightly fleet sweep:
  `gh secret set PRISMIC_TOKEN_<REPOSITORY NAME> --repo reddoorla/reddoor-maintenance` — per Prismic repository, from the table/command above.

Fleet mode sets `allowGenericToken: false` and refuses `PRISMIC_WRITE_TOKEN` on purpose: one generic token in an environment that iterates every repository would attach the wrong client's credential to every site after the first.

---

## 5. Rolling the delivery workflow out to a site

The reusable workflow's **source of truth is [`workflows/reusable/prismic-models.yml`](../../workflows/reusable/prismic-models.yml) in this repo** — authored here so it is tested and reviewed in the same PR as the CLI it calls (`tests/build/reusable-prismic-workflow.test.ts` executes the file's own comment step and measures the bytes it produces). It is copied into `reddoorla/.github` and tagged. **Edit it here and re-publish; never edit it there.**

`reddoor-maint prismic-ci [site]` lands the small caller workflow in a site repo as a PR. It refuses, per site, when:

- the reusable-workflow pin is unresolved (see below);
- the repo has no `PRISMIC_WRITE_TOKEN` secret (it would red the repo on its first model PR);
- the repo's default branch is not `main` (the apply job guards `refs/heads/main`, so merged model changes would never reach Prismic);
- the working tree is dirty, or a delivery PR is already open.

### The pin currently ships unresolved — the recipe refuses every site

`src/recipes/prismic-ci/template.ts` pins the reusable workflow by 40-hex SHA, and today it holds the placeholder `UNRESOLVED-publish-and-tag-reddoorla-dot-github-first`. It is deliberately not SHA-shaped: a placeholder that looked like a real commit would be indistinguishable in review and would install a workflow referencing a nonexistent commit into fifteen client repositories, failing at workflow-load time on every model PR with an error naming neither the file nor the reason.

So `isPinResolved()` is false, and **`prismic-ci` refuses on every site until the release is published and the pin is set**. To resolve: publish and tag the workflow in `reddoorla/.github`, then set `REUSABLE_WORKFLOW_PIN.sha` to `gh api repos/reddoorla/.github/commits/<tag> --jq .sha` and `.tag` to that tag. Nothing else changes. Renovate's github-actions manager bumps the per-repo pin afterwards, like any other pinned action.

---

## 6. When the nightly reds

[`.github/workflows/fleet-prismic-drift.yml`](../../.github/workflows/fleet-prismic-drift.yml) runs at 05:00 UTC, read-only. **Drift never reds it** — a site whose models diverge is a finding written to that site's Airtable row. A red run means the fleet could not be established, which is an outage in the instrument. The step checks six conditions; four exit non-zero, two only warn.

| Gate                                      | Red? | What it means                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `⚠ N site(s) skipped (could not prepare)` | warn | a site was dropped during prep — nobody read it. It still gets a `failed` row and an `unknown` verdict; raised before the exit gate so it stays visible on red nights too.                                                                                                                                                                   |
| CLI exit ≠ 0                              | RED  | outage. Causes, all named by the refusal line the step greps for `⛔`: a majority of repos unreadable (`failed > checked`), two repos claiming one Prismic repository, two repositories deriving one token secret, an inventory that resolved no sites, not one site actually checked, or an Airtable write-back that could not open at all. |
| no `FLEET_WRITE_SUMMARY` line             | RED  | the run reached neither the write-back nor any refusal, so its exit 0 is a claim about nothing. Do not read the green exit as a result.                                                                                                                                                                                                      |
| `failed > 0`                              | warn | partial write-back miss. Visible even inside tolerance, so a tolerated flake is never invisible.                                                                                                                                                                                                                                             |
| `wrote == 0`                              | RED  | total write-back failure — check the Airtable PAT, base id, and the three Prismic columns. Every verdict this run computed is unrecorded, and the cockpit keeps yesterday's green ticks. (This is the check `fleet-smoke.yml` lacked when it stayed green through nine of eleven sites failing.)                                             |
| `failed * 4 > total` (>25%)               | RED  | mass write failure, not a single-site flake.                                                                                                                                                                                                                                                                                                 |

A red run files (or comments on) a single deduped tracking issue titled **"Nightly Prismic model drift sweep failing"**, and closes it on the next green run. The alert steps are `continue-on-error` so they can never turn a run red — or green.

Two mechanics in that step are load-bearing and should survive any edit: `set -o pipefail` (Actions' default `bash -e {0}` does not set it, and without it `| tee` swallows the sweep's exit status, so every outage above reads as a clean run), and `|| true` on every `grep` (under `set -e` a no-match inside a command substitution aborts the step before the diagnostics run).

**A dead cron is caught elsewhere, not here.** `collectPrismicDriftAlerts` escalates any verdict nobody has re-established — a `pass` older than 7 days, a `fail`/`unknown` older than 3 days, or an undateable `pass` — into a `prismic-stale:` attention item. So a nightly that silently stops surfaces as "the check has not run recently", never as a fleet of stale green ticks.

---

## 7. Responding to a drift alarm

Each site's row carries `Prismic Models` (`pass` / `fail` / `unknown`), `Prismic Models Checked At`, and `Prismic Models Drift` (the first lines of the delta). The digest and cockpit raise one item per site:

- **`prismic-drift:`** — repo and Prismic diverge.
- **`prismic-unknown:`** — the check RAN AND COULD NOT ANSWER (unreadable checkout, dead write token, unreachable Prismic). Fix the secret or the checkout, not the model.
- **`prismic-stale:`** — nobody has re-established this verdict inside its window.

All three are `warning`, not `critical`: any item already tiers the site 🔴 on the cockpit, and `critical` is reserved for guardrails that are actively losing leads or breaking a live page.

Then:

1. **See the delta.** `reddoor-maint prismic-models <site>` — read-only, and it performs a real read, so it also proves whether the token works.
2. **Local ahead** (models in the repo that Prismic lacks, or differ) → merge a PR touching the model paths; the site's own CI pushes on merge. Never push the fleet.
3. **Remote ahead / remote-only** → `reddoor-maint prismic-models <site> --pull`, review the working-tree diff, open a PR. This is the _safe_ answer to a remote-only model; deletion is not an option the code has.
4. **Never delete from CI**, and never reach for a fleet-wide push: `--fleet --apply` is refused with exit 2, and the refusal says why.

One sweep caveat that changes how you read a row: the fleet sweep **never fetches, pulls or resets a checkout**, so a verdict describes the commit printed beside the site (`@<sha>`), not that repo's default branch. In CI every site is cloned fresh into `RUNNER_TEMP`, so this bites locally, not nightly.

---

## 8. Two absent-vs-unreadable collapses live in shared code — verified, unfixed

Both are in [`src/github/gh.ts`](../../src/github/gh.ts), both are out of scope for this project, and both change how you read a rollout result. Verified against the source on 2026-08-13:

- **`secretExists` reads only _repo_ secrets.** It calls `gh api repos/<repo>/actions/secrets?per_page=100` and name-matches the list. Org secrets visible to the repo live behind a different endpoint (`.../actions/organization-secrets`) and are never consulted, so **an org secret with repo visibility reads as absent**. Concretely: `prismic-ci` would refuse such a site with "`<repo>` has no `PRISMIC_WRITE_TOKEN` Actions secret" while the workflow would have run fine. Today `prismic-ci` is the only live caller — `self-updating` stopped planting `RENOVATE_TOKEN` per repo when Renovate moved to the GitHub App, whose credentials are org-level with all-repos visibility, i.e. exactly the shape this function cannot see.
- **`fileContentsOnBranch` maps _any_ non-zero `gh` exit to `null`.** The line is `if (r.code !== 0) return null; // 404 = file absent on this branch`, so an auth failure, a rate limit or a network error all read as "file absent". In `prismic-ci` that would mean "no delivery workflow on `main`" and would propose installing one. The recipe's step 7 (an open-PR check on the `maint/prismic-ci-*` branch prefix) is the backstop that stops it opening a duplicate PR every run, and it says so in a comment — a backstop, not a fix.

If either is fixed, fix it in `gh.ts` with the discrimination rule this project used everywhere else: only the signal that genuinely means non-existence may take the absent branch.

---

## 9. The capability guard is a tripwire, not a security boundary

`src/prismic/models/` is covered by a module-wide, AST-based capability guard — it lives in [`tests/prismic/models/index.test.ts`](../../tests/prismic/models/index.test.ts) and runs under `pnpm test` (not `pnpm build`). It parses every file in the directory, recursively, and allow-lists the modules each may name, the bindings each may take off them, the free identifiers each may reference, the one request method the module may write (`POST`, in `remote.ts`), and the four filesystem-mutating call sites — with their arguments — in `write.ts`. It exists because the no-delete guard failed four times before it, each fix closing exactly the channel the previous one missed.

**It caught 31 of its author's 31 attacks. It then took 144 from a red team, caught 90, and 19 escapes were confirmed by independent verifiers.** Four root causes of those 19 were fixed (the method axis, the file-wide declared-name set, the `spawn` spelling sentinel, and the ungoverned arguments of granted verbs), each re-proven by mutation with the shape that motivated it. What remains open is not a to-do list — several classes are **structurally unclosable by any identifier allow-list**. The guard's own header is the authority; reproduced:

1. **Injected capabilities.** A capability handed in as a parameter names no module. Measured: an inline-typed spawner, aliased before its call, passed the guard 14/14 green. Narrowing `writeModelFile` to a `FormatModelFile` (rather than an arbitrary-argv `SpawnFn`) shrank the class by one large member; it did not close it, and source-local analysis cannot.
2. **`.constructor` and reflection.** `Object.constructor` is `Function`, so arbitrary code is one property access off any value the module holds. The rule against it is the file's one deny-list, on the word `constructor`. Measured: `x["cons" + "tructor"]` passed 14/14 green. `Object.getOwnPropertyNames` and `Object.getPrototypeOf(x).constructor` reach the same place.
3. **Shadowing inside the function that shadows.** Free identifiers now resolve per scope, so one parameter named `fetch` no longer unlocks a whole file — but inside that function the parameter still hides the global, and the guard cannot see what the caller passed.
4. **What the pinned arguments do not say.** The four mutating call sites are pinned by spelling; nothing constrains the values that flow into them.
5. **Runtime.** Everything is static. Nothing constrains what an injected `fetch` or `format` actually does at run time.
6. **Out of scope entirely.** It reads `src/prismic/models/` and nothing else — including the test file itself, which could be edited to assert nothing. The exact-file-list and count pins are the only defence there, and they defend against accident, not intent.

State it the way the header does: **it catches the delete a colleague adds because it was the obvious next line. It does not stop an author who is trying to get one past it** — the module legitimately holds `fetch`, a write token, `writeFile` and `rename`, and JavaScript hands every value a route to `Function`. Do not cite it as a guarantee that no delete can occur; every previous version of this guard was trusted past what it proved.

One consequence for ordinary work: the mutating-call-site pin is the strictest rule in the file and **will red on an honest rename of a local in `write.ts`**. That was measured, not discovered later. The fix is one line in the expected list — plus the review that implies.

---

## 10. Two traps worth knowing before you touch the comparison

- **The `""` → `null` trap.** `canon` drops empty strings as well as `null`/`undefined`, because Prismic coerces `""` to `null` on ingest (proven by a round-trip on `the-pinnacle`: sent `height: ""`, read back `height: null`). If a future change makes `canon` keep `""`, hedloc-shaped sites alarm forever on a divergence that does not exist — a push sends `""`, Prismic stores `null`, the next scan diffs again. `tests/prismic/models/canon.test.ts` is the guard. The same rule drops `imageUrl` at any depth: Prismic owns the slice preview screenshot, so its value is meaningless for comparison.
- **Prettier on generated JSON.** Pulled-down models are formatted by the _target repo's own_ prettier, resolved by absolute path at `<repo>/node_modules/.bin/prettier` (via `realpath`, so a dangling shim reads as absent). Never `pnpm exec` in a client repo — that runs a full `pnpm install` in it first, materialising `node_modules/` as a side effect of a read-shaped command. Formatting is best-effort: `--pull` marks each unformatted file `(unformatted)` and prints `⚠ could not prettier-format written files (prettier unavailable?) — verify CI formatting`. A PR that reds on `prettier --check` for a model file means that step did not run — look for that flag in the command output.

---

## 11. Slice Machine, and Type Builder

**Slice Machine stays installed** as the local visual authoring tool. It is simply no longer the delivery path. It was declared unmaintained on 2026-07-20 with no sunset date, and 2.21.5 shipped 17 days after that announcement — time pressure, no fire. Removing it, and any move from `slicemachine.config.json` to `prismic.config.json`, is a separate later decision. (Both filenames are already read, in that order, so a half-migrated repo does not go dark.)

**Do not run `prismic init`.** It is a destructive config rewrite, not an idempotent setup step: it `rm -r`s any local slice directory absent from the remote — component code included — rewrites `package.json` and the lockfile, AST-edits `vite.config.ts`, and makes remote writes to the live Prismic repository even under `--no-setup`.

**Type Builder must stay OFF.** It is an Admin-only web UI that saves straight to the cloud with no branch, no PR and no CI — enabling it removes Git as the gate and makes the repo stop being the source of truth. The nightly drift check is the backstop that would catch it being used, as a `fail` verdict on a site nobody sent a PR for.

# Test Fixtures

Five minimal SvelteKit-shaped trees used across audit and recipe tests.

| Fixture             | Purpose                                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------- |
| `pristine-starter/` | Versions and configs match the baseline. Used to assert audits return `pass`.                              |
| `drifted-configs/`  | Configs are stale and some deps are bumped past the baseline. Used to assert audits surface drift.         |
| `pre-svelte5/`      | `svelte: ^4.x` and matching Svelte-4-era deps. Used by the `svelte-4-to-5` recipe tests.                   |
| `sync-clean/`       | All four `sync-configs` templates already present and matching. Used to assert the recipe returns `noop`.  |
| `sync-drift/`       | None of the templates match (or are missing entirely). Used to assert the recipe applies all four.         |
| `prettierignored-generated/` | `pristine-starter/` plus an unformatted, generator-written `prismicio-types.d.ts` that its `.prettierignore` lists. Used to assert the lint audit honours the site's ignore file. |
| `kit3-starter/` | reddoor-starter on SvelteKit 3: `eslint.config.js`, `sveltekit.config.js` and `vite.config.ts` are byte copies of reddoor-starter at `718db58` (reddoor-starter#187). Used to hold the kit 3 `sync-configs` templates to the starter; `REDDOOR_STARTER_DIR=<checkout>` makes `kit3.test.ts` also compare the copies with a live checkout. |

`content-check/` holds the instrument proofs for `reddoor-maint content-check` (P1-120): `clean/` (every visible word, image and link comes from Prismic, behind code fallbacks in each form the check recognises, plus a legal page and a `/dev` page that are exempt), `dirty/` (at least one hard-coded literal of every kind), and `vineyard/before` and `vineyard/after` (reddoorla/vineyard-custom-homes's gallery page at `be56f67` and `8e6c939`, either side of its PR #159). `tests/content-check/site.test.ts` reads them.

`bring-main-lockfiles/alamo-2026-11-10/` holds alamo-anatomy's `pnpm-lock.yaml` at `main` 490f148 and `staging` fbe8c7e, and the merge of the two that `scripts/staging-bring-main.mjs` made with pnpm 12.5.1 before it checked what pnpm chose (`merged`, which puts `staging`'s rolldown, cookie and @netlify/types back), gzipped. `tests/scripts/staging-bring-main.test.ts` reads them.

`renovate-action-if-oracle.json` holds GitHub's verdicts on 112 `if:` values, from reddoorla/reddoor-maintenance#1607 (workflow-parser and expressions 0.3.61). `tests/recipes/renovate-action-disabled-job.test.ts` places each as the `if:` of the Renovate job and its steps. An `INV` value (a file GitHub rejects) is expected to give no gap: an invalid workflow is not this check's to report.

Fixtures are checked in. Tests copy them to a tempdir before running mutating recipes; audits read them in place.

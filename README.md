# `@reddoorla/maintenance`

Canonical maintenance configs, audits, and recipes for the reddoor SvelteKit + Prismic fleet.

A single CLI (`reddoor-maint`) covering the full operator workflow:

- **Audits** inspect a site (lighthouse, a11y, security, lint, deps).
- **Recipes** mutate one (branch-isolated, idempotent, never on a dirty tree) — start with [`init`](#init) for fresh sites.
- **Reports** ([per-site monthly/quarterly emails](#reports-per-site-maintenancetesting-emails)) draft + send client-facing maintenance + testing summaries, backed by Airtable as the source of truth and Resend for delivery.
- **Canonical configs** (eslint, prettier, lighthouserc, playwright-a11y, svelte) ship as importable presets every reddoor site shares.

Designed to run against either a single local site or a fleet declared in an inventory file.

```bash
pnpm add -D @reddoorla/maintenance
pnpm reddoor-maint --help
```

---

## The onboarding flow

A reddoor site goes through this sequence the first time you adopt the package. Each recipe is idempotent — running it again on an already-onboarded site is a `noop`.

```bash
pnpm reddoor-maint init
```

`init` runs the whole chain in order against the current directory (or `init [site]` for an explicit path). It's a thin orchestrator — every underlying recipe still creates its own branch and stops on a dirty tree, so the operator ends up with a stack of `maint/<recipe>-<ts>` branches to PR.

```text
convert-to-pnpm  →  onboard  →  sync-configs  →  svelte-codemods  →  a11y-fixtures-page  →  audit
```

| Step | Recipe               | What it does                                                                                                                                                                                                                  |
| ---- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `convert-to-pnpm`    | Removes `package-lock.json` / `yarn.lock`, pins `packageManager: pnpm@…`, rewrites `npm` references in scripts, runs `pnpm install` to materialise `pnpm-lock.yaml`.                                                          |
| 2    | `onboard`            | Installs `@reddoorla/maintenance` + the audit deps (`@lhci/cli`, `@playwright/test`, `@axe-core/playwright`) on the site. Pins the maintenance dep to a caret range against this package's own version at runtime.            |
| 3    | `sync-configs`       | Writes the canonical config templates into the site (eslint, prettier, lighthouserc, playwright config, svelte config) and merges canonical entries into `.gitignore`.                                                        |
| 4    | `svelte-codemods`    | Optional cleanup pass applying the Svelte 5 gotcha codemods (`export let` → `$props()`, `on:event` → `onevent`, `$:` → `$derived`/`$effect`, etc.) for sites that surface new strictness warnings after the original upgrade. |
| 5    | `a11y-fixtures-page` | Writes a starter `src/routes/dev/a11y-fixtures/+page.svelte` if the route doesn't already exist. The hardcoded URL in `lighthouse` and `playwright-a11y` configs targets this route. Operator edits are never clobbered.      |
| 6    | `audit`              | Runs `deps`, `lighthouse`, `a11y`, `security`, `lint` — see [Audits](#audits).                                                                                                                                                |

Each recipe refuses to run on a dirty working tree, creates a fresh `maint/<recipe>-<UTC-ms-timestamp>` branch, and emits one or more atomic commits. Running individual steps standalone (e.g. `reddoor-maint sync-configs`) still works — `init` is for when you want the whole chain in one command.

---

## CLI

```text
reddoor-maint list-audits       # audit descriptions
reddoor-maint list-recipes      # recipe descriptions

reddoor-maint init [site]       # full onboarding chain (preferred entrypoint)
reddoor-maint audit [site]      # run audits
reddoor-maint report [site]     # draft / send per-site maintenance + testing emails (see Reports)
reddoor-maint sync-configs [site]
reddoor-maint bump-deps [site]
reddoor-maint convert-to-pnpm [site]
reddoor-maint onboard [site]
reddoor-maint svelte-codemods [site]
reddoor-maint upgrade svelte-4-to-5 [site]
```

`[site]` defaults to `process.cwd()`. Add `--fleet path/to/inventory.json` (or `.mjs` / `.js`) to run across every site in an inventory instead. `--cwd <path>` overrides the working directory for any command.

### Common flags

- `--only <names>` — comma-separated subset. Validates against the known set; typos exit with code 2.
  - `audit`: `deps`, `lighthouse`, `a11y`, `security`, `lint`
  - `sync-configs`: `eslint`, `prettier`, `lighthouse`, `playwright-a11y`, `svelte`, `gitignore`
- `--dry` (sync-configs) — print the planned diff without writing.
- `--group patch | minor | major` (bump-deps) — semver bucket. Default `minor`.
- `--audits lighthouse,a11y` (onboard) — which audit deps to ensure.
- `--verbose` — print full stack on errors instead of just the message.

### Exit codes

- `0` — success (including `noop`)
- `1` — at least one audit failed, or a recipe returned `failed`
- `2` — invalid argument (e.g. unknown `--only` name, unknown `--group`)

---

## Recipes

Each recipe is `(site, opts?) => Promise<RecipeResult>` and is also exported from the package entry as a library function:

```ts
import {
  init,
  syncConfigs,
  bumpDeps,
  onboard,
  convertToPnpm,
  svelteCodemods,
  a11yFixturesPage,
  upgradeSvelte4to5,
} from "@reddoorla/maintenance";
```

Shared contract — every recipe:

- **Refuses to run on a dirty working tree.** Either throws (most recipes) or returns `{ status: "failed", notes: "…" }` (e.g. `onboard` when `pnpm-lock.yaml` is missing, `bump-deps` when a competing lockfile is present).
- **Creates a fresh branch** `maint/<recipe>-<UTC-millisecond-timestamp>` before mutating anything.
- **Emits atomic commits** — each logical change gets its own commit.
- **Is idempotent** — re-running on the already-applied state returns `{ status: "noop", commits: [] }` without creating a branch.
- **Returns a `RecipeResult`** — `{ recipe, site, status: "applied" | "noop" | "failed", commits: string[], notes?: string }`.

### `init`

One-shot guided onboarding — the recommended entrypoint for a fresh site. Runs `convert-to-pnpm → onboard → sync-configs → svelte-codemods → a11y-fixtures-page → audit` in sequence. Each underlying recipe still creates its own branch — `init` is a thin orchestrator, not a branch-collapser. Stops the chain on the first `failed` recipe or uncaught error; `noop` results continue the chain. Exit code is 1 if any step failed _or_ the final audit pass reports a `fail`.

The remaining sections describe each step `init` invokes (in chain order), plus the standalone recipes that aren't part of onboarding.

### `convert-to-pnpm`

Removes the npm or yarn lockfile, pins `packageManager: pnpm@X.Y.Z` in `package.json`, rewrites `npm`/`npx`/`yarn` references in scripts to their pnpm equivalents, removes any leftover flat `node_modules` (to avoid phantom-dep contamination), then `pnpm install` to materialise `pnpm-lock.yaml`. Three to four commits depending on what's present. `noop` if `pnpm-lock.yaml` already exists.

### `onboard`

Adds `@reddoorla/maintenance` + the audit deps (`@lhci/cli`, `@playwright/test`, `@axe-core/playwright`) to the site's `devDependencies` if they're missing. Audit dep versions come from `src/configs/baseline-versions.ts` so they can't drift from the rest of the package. The maintenance dep is pinned to a caret range against this package's own version at runtime — no manual syncing required at each minor bump. Refuses with `{ status: "failed", notes: "run convert-to-pnpm first" }` if the site has no `pnpm-lock.yaml`.

### `sync-configs`

Writes the canonical config templates into the site (eslint, prettier, lighthouserc, playwright config, svelte config) and merges the canonical entries into `.gitignore`. Each config is its own commit. `--dry` reports the planned diff (including gitignore drift) without writing. `--only <name>[,<name>]` restricts to a subset.

### `svelte-codemods`

Standalone codemod pass for sites already on Svelte 5. Applies the same gotcha codemods the full `svelte-4-to-5` recipe runs (`export let` → `$props()`, `on:event` → `onevent`, `$:` → `$derived`/`$effect`, `$$props.class` rewrite, `$$restProps` → destructured `...rest`, `$state` + `$effect` → `$derived`). Useful when post-upgrade Svelte 5 surfaces new strictness warnings and the fleet needs a clean re-application.

### `a11y-fixtures-page`

Writes a starter `src/routes/dev/a11y-fixtures/+page.svelte` if the route doesn't already exist. The `lighthouse` and `playwright-a11y` configs both target this URL — newly-onboarded sites need the route to exist for either audit to pass. The template is intentionally generic (semantic landmarks + headings + a relative link); operator edits to an existing page are never clobbered.

### `bump-deps` _(standalone — not part of `init`)_

Pre-flights that the site is on pnpm (refuses with a clear remediation if `package-lock.json` or `yarn.lock` is present without `pnpm-lock.yaml`), runs `pnpm install` to ensure the lockfile is current, then `pnpm outdated --json` to decide whether anything needs upgrading. If yes: creates a branch and runs `pnpm up` scoped to the requested `--group` (patch / minor / major), then commits the result. `noop` if nothing's out of date.

### `upgrade svelte-4-to-5` _(standalone — not part of `init`)_

The full 7-step Svelte 4 → 5 migration: bump framework versions, migrate `svelte.config.js`, run the official `svelte-migrate` codemod, run `@tailwindcss/upgrade`, apply gotcha codemods over `src/**/*.svelte`, verify with `pnpm install` + `pnpm run check`, and write a `MIGRATION_SVELTE_5.md` summary. Each step is its own commit; the file leaves a record of what ran and what may need manual review.

---

## Audits

Each audit is `(ctx) => Promise<AuditResult>` and is exported from the package entry. All audits return a closed-union status: `"pass" | "warn" | "fail" | "skip"`.

| Name         | What it checks                                                                                                                                                                                                  |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deps`       | Diffs site's `package.json` against `src/configs/baseline-versions.ts`. Surfaces deps that drift from the canonical version map.                                                                                |
| `lighthouse` | Runs `@lhci/cli autorun` using the canonical `lighthouserc.json`. Hits `/dev/a11y-fixtures` by default; sites without that route can set `package.json#reddoor.lighthouseUrl` to override.                      |
| `a11y`       | Spawns Playwright + `@axe-core/playwright` against a canonical set of a11y routes.                                                                                                                              |
| `security`   | `pnpm audit --json --prod` with automatic fall-through to `npm audit` when pnpm can't run (missing lockfile, error envelope, etc.). Normalises advisory shapes from both tools into a single `AdvisoryEntry[]`. |
| `lint`       | ESLint + Prettier using the canonical configs (re-exported via `@reddoorla/maintenance/configs/eslint` and `@reddoorla/maintenance/configs/prettier`).                                                          |

```bash
reddoor-maint audit                                # all five against cwd
reddoor-maint audit --only security,a11y           # a subset
reddoor-maint audit --json                         # machine-readable output
reddoor-maint audit --fleet inventory.json         # batch across an inventory
```

---

## Fleet mode

Pass `--fleet <path>` to run a command against multiple sites declared in an inventory file. Inventory files can be:

- **`.json`** — an array of site objects (most common).
- **`.mjs`** / **`.js`** — an ES module whose default export is `() => Promise<Site[]>` (useful when site list comes from an API).

### Inventory file format (`.json`)

```json
[
  {
    "path": "/Users/me/Documents/GitHub/caltex-landing",
    "name": "caltex-landing",
    "repoUrl": "https://github.com/redacted/caltex-landing.git"
  },
  {
    "path": "/Users/me/Documents/GitHub/espada",
    "name": "espada"
  }
]
```

| Field     | Required | Notes                                                                                                                                                                                                                                                                                                                                     |
| --------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `path`    | yes      | Must be **absolute**. Relative paths are rejected so the invocation's cwd can't accidentally change which site is targeted.                                                                                                                                                                                                               |
| `name`    | no       | Friendly label for log output. Falls back to `path` when omitted.                                                                                                                                                                                                                                                                         |
| `repoUrl` | no       | When set, recipes that run with `--fleet --workdir <dir>` will `git clone` the site into `<workdir>/<name>` if it isn't already there. URL scheme is validated against an allowlist (`https://`, `http://`, `ssh://`, `git://`, `file://`, scp-style `user@host:path`) and `git clone` is invoked with `--` to neutralise argv-injection. |
| `meta`    | no       | Free-form object preserved on the `Site` for downstream consumers.                                                                                                                                                                                                                                                                        |

`--workdir <path>` selects the clone target (default `~/.reddoor-maint/sites`). Without `--workdir`, fleet sites are expected to already exist at their declared `path`.

---

## Library usage

The package's main entry exports every recipe, audit, and report function so you can wire them into custom tooling (CI jobs, scheduled scripts, alternative CLIs):

```ts
import {
  // recipes
  init,
  convertToPnpm,
  onboard,
  syncConfigs,
  svelteCodemods,
  a11yFixturesPage,
  bumpDeps,
  upgradeSvelte4to5,

  // audits
  runAudits,
  ALL_AUDIT_NAMES,

  // reports (per-site maintenance / testing emails)
  draftReportForSite,
  sendApprovedReports,
  renderReportHtml,
  findDueReports,

  // recipe registry
  ALL_RECIPE_NAMES,
  isRecipeName,
} from "@reddoorla/maintenance";

const result = await syncConfigs({ path: "/abs/path/to/site" });
if (result.status === "applied") {
  console.log(`applied ${result.commits.length} commits on branch ${result.notes}`);
}
```

The canonical configs are also importable as their own subpath exports — sites use these in their own root configs:

```js
// eslint.config.js
import { createEslintConfig } from "@reddoorla/maintenance/configs/eslint";
import svelteConfig from "./svelte.config.js";
export default createEslintConfig({ svelteConfig });
```

```js
// svelte.config.js
import { createSvelteConfig } from "@reddoorla/maintenance/configs/svelte";
export default createSvelteConfig();
```

```js
// playwright.config.ts
export { default } from "@reddoorla/maintenance/configs/playwright-a11y";
```

---

## Troubleshooting

**`--only <name>` and nothing happened?**
Make sure you spelled the name correctly. The CLI validates against the known set and exits with code 2 on a typo — but if you're invoking the recipe programmatically and passed an invalid name, you'll just see a `noop`. `reddoor-maint list-audits` and `reddoor-maint list-recipes` print the canonical names.

**Recipe refused to run with `"working tree is not clean"`?**
Recipes refuse to mutate on top of uncommitted work. Either commit/stash your changes, or run on a clean checkout.

**`bump-deps` returned `failed: site has package-lock.json but no pnpm-lock.yaml`?**
Run `reddoor-maint convert-to-pnpm` first. `bump-deps` is pnpm-only.

**`onboard` returned `failed: no pnpm-lock.yaml`?**
Same — run `reddoor-maint convert-to-pnpm` first. Onboarding is intentionally split from package-manager conversion so the two transitions are reviewable separately.

**`security` audit returned `skip`?**
Neither `pnpm audit` nor `npm audit` produced a parseable result. Check that at least one of pnpm or npm is on `PATH` and that the site has a corresponding lockfile.

**Where do the canonical baseline versions come from?**
[`src/configs/baseline-versions.ts`](src/configs/baseline-versions.ts). The `deps` audit compares against this map, and `onboard`'s audit deps source their pins from here too — so any version bump in baseline-versions automatically flows through to fresh onboards.

---

## Reports (per-site maintenance/testing emails)

Generates the monthly/quarterly/yearly client-facing email reports — Lighthouse scores + GA users + the standard checklist + per-client header image — from Airtable as the source of truth, delivered via [Resend](https://resend.com/).

### Required env

```bash
AIRTABLE_PAT=patXXXX          # Airtable PAT: schema.bases:read, data.records:read+write
AIRTABLE_BASE_ID=appHG8nLOzULzXOER
RESEND_API_KEY=re_XXXX
RESEND_WEBHOOK_SECRET=whsec_XXXX  # only for the deployed webhook
```

### Operator flow

0. **Prereq: refresh Lighthouse scores on each Websites row.** From each site's checkout:

   ```bash
   reddoor-maint audit lighthouse --write-airtable
   ```

   This runs Lighthouse and writes the 4 scores directly to the matching Websites row (slug auto-derived from `package.json#name`; pass `--write-airtable=<slug>` to override), along with a `Last lighthouse audit at` timestamp. The report orchestrator copies these into the new Reports row — drafting a report for a site missing scores fails with a clear error.

1. **Draft overdue reports**

   ```bash
   reddoor-maint report --due
   ```

   Scans Websites where `maintenence freq` ≠ `None`, finds (site, type) pairs whose next-due date has passed, creates Reports rows with snapshotted scores + attaches the rendered HTML preview.

2. **Preview a single site without touching Airtable**

   ```bash
   reddoor-maint report <slug> --preview
   ```

   Writes `reports/<slug>/draft.html` locally — open in a browser to verify before any side effects. (The header image renders broken in the browser because the CID can only resolve inside an email client; that's expected for a preview.)

3. **Review on Airtable mobile**
   - Tap the `Rendered HTML` attachment on the Reports row to preview in Safari.
   - Fill in `GA users (period)` and `GA users (prev period)`.
   - Optionally add a `Commentary` line; optionally override the subject.
   - Flip `Approved to send`.

4. **Send approved reports**

   ```bash
   reddoor-maint report --send-ready
   ```

   Renders + sends every Reports row with `Draft ready=true && Approved to send=true && Sent at IS NULL`. Stamps `Sent at` + `Delivery status=pending` on each.

5. **Delivery status updates automatically** via the Resend webhook (Netlify Function at `netlify/functions/resend-webhook.mts`) — `Delivery status` flips to `delivered` / `bounced` / `complained` as events arrive. Deploy procedure: see [Webhook deployment](#webhook-deployment-netlify--resend) below.

### Webhook deployment (Netlify + Resend)

The Resend delivery webhook lives at `netlify/functions/resend-webhook.mts` in this repo. Deploying it is a one-time operation per environment: connect the repo to a Netlify site, set three env vars, register the deployed URL with Resend.

**1. Create the Netlify site:**

- New site → Import from Git → pick `tucksravin/reddoor-maintenance`.
- Branch to deploy: `main`. Build settings are read from [`netlify.toml`](netlify.toml) (no build command needed — functions-only).
- Site name: pick something stable (e.g. `reddoor-webhooks`) since it ends up in the public webhook URL.

**2. Set env vars** in Site settings → Environment variables:

| Variable                | Value                                                                       |
| ----------------------- | --------------------------------------------------------------------------- |
| `AIRTABLE_PAT`          | Same PAT used by the CLI (read+write on the Websites + Reports tables)      |
| `AIRTABLE_BASE_ID`      | `appHG8nLOzULzXOER`                                                         |
| `RESEND_WEBHOOK_SECRET` | Generated by Resend in step 4 — paste back here after creating the endpoint |

**3. Trigger a deploy** (Deploys → Trigger deploy → Deploy site). When it goes green, curl the health endpoint:

```bash
curl https://<your-site>.netlify.app/.netlify/functions/resend-webhook
```

Expected:

```json
{
  "status": "ok",
  "service": "reddoor-resend-webhook",
  "env": {
    "RESEND_WEBHOOK_SECRET": true,
    "AIRTABLE_PAT": true,
    "AIRTABLE_BASE_ID": true
  }
}
```

Any `false` means the env var didn't land — re-check step 2 and re-deploy. The health endpoint reports presence-only and never returns secret values, so the output is safe to share in a support ticket.

**4. Register the webhook in Resend:** [resend.com/webhooks](https://resend.com/webhooks) → Add Endpoint → paste the function URL from step 3 → select events `email.delivered`, `email.bounced`, `email.complained` → save. Copy the generated **Signing Secret** (`whsec_…`) into Netlify's `RESEND_WEBHOOK_SECRET` env var (step 2) and trigger another deploy so the secret takes effect.

**5. End-to-end smoke test (using ERP Industrials):**

```bash
# from your CLI:
reddoor-maint report erp-industrials   # drafts a Maintenance report → Airtable
# approve the draft in Airtable, then:
reddoor-maint report --send-ready
```

Within a few minutes, watch the ERP Reports row's `Delivery status` flip from `pending` → `delivered` as Resend pings the webhook. Function logs in Netlify show each event with its messageId + new status. If the webhook returns 5xx, svix retries; check the Netlify function log for the error envelope.

### Frequency math

Per (site, type): `dueDate = max(last Sent at for this type, Websites.maintenance day fallback) + frequency months`. A site with no Reports row AND no fallback day is due immediately.

### Header images

Each Website row's `Header image` attachment is fetched at send time and embedded inline via CID (Content-ID) in the email — no CDN, no link rot, ~100 KB per send.

---

## Versioning

Patch / minor / major bumps follow [Changesets](https://github.com/changesets/changesets). The release workflow opens a version-bump PR on every merge to `main` with pending changesets; merging that PR triggers the publish step. Releases are signed via npm OIDC trusted publishing — no long-lived `NPM_TOKEN` lives in CI.

## License

MIT © Tucker Lemos

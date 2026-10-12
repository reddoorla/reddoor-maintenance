# Plan: SvelteKit 3 and adapter-netlify 7 (October 2026)

P1-45, issue #1297. Renovate opened `@sveltejs/kit` 3 and
`@sveltejs/adapter-netlify` 7 in six repos overnight on 2026-10-12, and all
twelve PRs fail `ci / ci`. This plan says what the fleet's config has to become,
what this repo had to change, and in what order the fleet can move. The fleet
roll-out itself is the operator's decision (Operator decisions, `docs/BACKLOG.md`);
nothing here has been pushed to a client repo.

Everything below marked _measured_ was read from kit 3.0.1 and adapter-netlify
7.0.1 as installed in reddoor-starter#187 (`src/core/config/options.js`,
`src/messages/build-errors.js`), or from a shallow clone of each client repo's
`main` on 2026-10-12 between 14:30Z and 14:45Z.

## 1. What kit 3 changes, and why every PR is red

- **The config file is gone.** `svelte-kit sync` stops with
  `config_file_unsupported`: "`svelte.config.js` is no longer used. Please pass
  configuration via the `sveltekit(...)` plugin in your Vite config." The
  options are passed top-level; a `kit:` key is `config_kit_namespace`.
  _Measured_, and the error in vida-legacy-foundation#97's `ci / ci` log.
- **Adapter 7 needs kit 3** (`peerDependencies: { "@sveltejs/kit": "^3.0.0-next.0" }`,
  _measured_). Each repo's two Renovate PRs can only land together, as one
  change. Neither is mergeable alone.
- **Kit 3's peers**: svelte `^5.57.1`, vite `^8.0.12`, vite-plugin-svelte
  `^7.0.0`, typescript `^6.0.0`, node `>=22.17` (_measured_). No Svelte 6 and
  no Vite major, so the brief's stop condition does not apply. All six red
  repos are already on vite 8, typescript 6 and Node 24. alamo-anatomy's
  lockfile holds svelte 5.57.0, one patch below the peer, so its migration
  carries a svelte bump.

Past the config error, the starter's migration (reddoor-starter#187) found
these, and each one is in every client repo too:

| Change                              | Kit 2                                                      | Kit 3                                                                                                                                                                                                                                                                         | In the six repos (_measured_)                                                                                                                                                         |
| ----------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Env vars                            | `$env/dynamic/*` reads anything set                        | only variables declared in `src/env.ts` (`defineEnvVars`) are exposed; `$env/dynamic/*` is a view of that list, so an undeclared read is `undefined` with a build **warning** only                                                                                            | 2 to 9 files per repo read `$env/*`                                                                                                                                                   |
| Param matchers                      | one file per matcher in `src/params/`, returning a boolean | one `src/params.ts` through `defineParams`; the directory is not read, and a route using a matcher fails with `param_matcher_missing`. **A matcher now returns the value, and only `undefined` fails**: `false` is a match whose value is `false` (`exports/params/index.js`) | 5 of 6 (`preview`; vida also `lang`, whose `isLangPrefix(param)` returns a boolean, so lifted as written `[[lang=lang]]` matches every first segment). la-homelessness-youth has none |
| `$app/environment`                  |                                                            | deprecated (a dev warning), re-exports `$app/env`                                                                                                                                                                                                                             | all six; not a break                                                                                                                                                                  |
| `tsconfig.json`                     | extends `./.svelte-kit/tsconfig.json`                      | extends `$app/tsconfig`, and kit no longer supplies `include`                                                                                                                                                                                                                 | all six                                                                                                                                                                               |
| Hooks types                         | `Handle` from `@sveltejs/kit`                              | from `@sveltejs/kit/hooks`                                                                                                                                                                                                                                                    | 4 of 6                                                                                                                                                                                |
| `$app/stores`                       | deprecated                                                 | **removed**: `page.subscribe` throws `app_stores_removed`, so every page using it fails at runtime; use `$app/state`                                                                                                                                                          | gallerysonder, 5 files (layout, error page, Footer, TitleBlock, artists)                                                                                                              |
| `error(404, { message })`, `json()` |                                                            | deprecated (warnings)                                                                                                                                                                                                                                                         | all six import `json`; 1 to 9 files call `error(n, { … })`                                                                                                                            |

**The env change is the one that ships green and broken.** The starter measured
it: a production build with no `src/env.ts` answered `/health` with
`ingestUrl:false, ingestToken:false, turnstile:false` while all three variables
were set. On a client site that is a contact form that silently stops
delivering. Every site's migration must declare every variable it reads, and
reddoor-starter#187's `scripts/kit-config.test.ts` (fails on an undeclared
`$app/env/*` read and on any `$env/*` read) is the gate to copy.

## 2. Where each config key the fleet uses moves

The keys below are every key set in the six red repos' `svelte.config.js`, the
`sync-configs` template, `createSvelteConfig` and the starter (_measured_).

| Key (kit 2, under `kit`)                                                               | Kit 3 (top-level in `sveltekit(...)`)                                                                                                                                                                                                                 | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `adapter`                                                                              | `adapter`                                                                                                                                                                                                                                             | adapter 7 keeps `edge` and `split`, adds `publish` (default `build`). It no longer reads `netlify.toml` for the publish directory; all six repos already publish `build/`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `alias`                                                                                | `alias`, **deprecated** (build warning)                                                                                                                                                                                                               | kit 3 no longer provides `$lib` (`module_removed_lib`), so `$lib` and `$lib/*` must be added to `alias` until the site moves to `#lib` subpath imports.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `csp`                                                                                  | `csp`                                                                                                                                                                                                                                                 | unchanged shape (`mode`, `directives`, `reportOnly`). The CSP baseline (`createSvelteConfig({ csp })`, `SVELTE_EVENT_REPLAY_HASH`) carries over as is.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `prerender.handleHttpError`, `handleMissingId`, `handleInvalidUrl`, `entries`, `crawl` | `prerender.*`                                                                                                                                                                                                                                         | unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `prerender.origin`                                                                     | **removed** (`config_option_removed_prerender_origin`). Its replacement, `paths.origin`, is **not** a rename: it is also the only origin kit 3's CSRF check accepts a form POST from (kit 2 compared with the request's own host). **Do not set it.** | Measured on reddoor-starter#187's built server with `paths.origin` set from `URL`: a form POSTed from a Netlify domain alias, or from a custom domain attached after the last build, answered **403**. No trusted-origins list can name hosts added after the build. The starter instead leaves `paths.origin` unset (kit keeps its `http://sveltekit-prerender` placeholder and kit 2's per-host CSRF check), exports `productionOrigin` from `sveltekit.config.js`, `define`s it as `__REDDOOR_SITE_ORIGIN__` in `vite.config.ts`, and `$lib/seo`'s `siteOrigin` puts it in place of the placeholder for canonical, og:url and og:image. Four of the six repos set `prerender.origin` (alamo-anatomy, mantis-landscaping, vida-legacy-foundation, williamson-construction-co); each copies those four pieces. |
| `csrf.checkOrigin`                                                                     | **removed**                                                                                                                                                                                                                                           | none of the six set it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `files.lib`                                                                            | **removed**                                                                                                                                                                                                                                           | none set it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `compilerOptions`, `preprocess`                                                        | same keys, passed in the same object (kit 3 accepts unknown top-level keys and hands them to vite-plugin-svelte)                                                                                                                                      |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `inlineStyleThreshold`                                                                 | `inlineStyleThreshold`                                                                                                                                                                                                                                | unchanged (mantis-landscaping sets `50_000`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

Where the object lives: reddoor-starter keeps it in `sveltekit.config.js`, which
`vite.config.ts` imports and passes to `sveltekit(kitConfig)`, because
`eslint.config.js`, the privacy-services plugin and the CSP and hatch tests all
import the same object with a bare `node`. The fleet follows the starter.
`eslint-plugin-svelte` reads `svelteConfig.kit.files.routes` and falls back to
`src/routes`, which every fleet site uses, so the flat object is enough for lint.

## 3. What this repo needed (landed with this plan)

- **`createKitConfig`** in `configs/svelte`: kit 3's options top-level, with the
  same canonical pieces as `createSvelteConfig` (warning filter,
  `$components/$utils/$stores/$assets` aliases, opt-in `csp`,
  `prismicRepository`, `placeholder`) plus `$lib`. It refuses a `kit` block.
  The three factory-shaped repos (alamo-anatomy, gallerysonder,
  la-homelessness-youth) migrate by swapping the call and lifting the `kit`
  keys one level.
- **`sync-configs`** reads the site's declared `@sveltejs/kit` major. On kit 3
  it never writes `svelte.config.js`; its `svelte` template is
  `sveltekit.config.js` (`createKitConfig`) and its `eslint` template imports
  `./sveltekit.config.js`, byte for byte the starter's `eslint.config.js`. A
  kit 3 site with no `sveltekit.config.js` (config inline in
  `vite.config.ts`) gets neither, because `sync-configs` owns neither
  `vite.config.ts` nor that choice. Kit 2 sites are unchanged.
- **What a sync cannot fix is reported** (`planKitHazards`), in the recipe's
  notes and as a `DRIFT <repo> <file> (move by hand, sync-configs will not)`
  line in `--dry` when `svelte` is targeted (the weekly sweep targets
  everything): a `svelte.config.js` on kit 3, an `eslint.config.js` still
  importing it on a kit 3 site with no `sveltekit.config.js`, and a kit spec it
  cannot read (`catalog:`, `workspace:`), where it writes neither file rather
  than guess a major. So the weekly
  `fleet-config-drift` sweep names a site that took the Renovate bump without
  the migration. `sync-configs` never deletes it: the options have to move
  first.
- **`analytics-tag` refuses a kit 3 site.** It edits only `svelte.config.js`,
  so on kit 3 it would report "no csp option" and install a GA4 tag the real
  CSP blocks. It now names the hosts and snippet to add by hand. Teaching it
  `sveltekit.config.js` is a follow-up (§5).
- **Not changed, deliberately:** `baseline-versions.ts` stays on kit `^2.61.1`
  and adapter `^6.0.4`. Moving it is the fleet roll-out: the deps audit would
  flag every kit 2 site, and `onboard` would install adapter 7 beside a kit 2
  config. It moves when the operator starts the roll-out.

## 4. Roll-out order

Each step is one PR per repo, reviewed, never a sweep (`AUTONOMY.md`, red tier
for fleet-wide mutations). In each repo the migration replaces both Renovate
PRs; close them as superseded once it lands.

1. **reddoor-starter** (reddoor-starter#187). Done when it lands.
2. **reddoor-starter-blux**, by cherry-pick from the starter (never a merge;
   see `CLAUDE.md`, "Two starter templates").
3. **The three starter-shaped sites: vida-legacy-foundation,
   mantis-landscaping, williamson-construction-co.** Their configs are the
   starter's (`alias`, `csp`, `prerender.origin`, `handleHttpError`,
   `handleInvalidUrl`), so #187's diff is the starting point and each one's own
   `ci` plus `@smoke` is the check. It applies almost file for file to
   williamson only. mantis reads its repository name from
   `slicemachine.config.json` and has no `prismic.config.json`, which the
   starter's `sveltekit.config.js` reads at load (ENOENT), and keeps
   `inlineStyleThreshold`. vida's `lang` matcher must return the param or
   `undefined`, not a boolean (§1), and its test must change with it. Highest value: vida is maintained and red in the cockpit.
4. **The three factory-shaped sites: la-homelessness-youth, gallerysonder,
   alamo-anatomy**, on a published `@reddoorla/maintenance` with
   `createKitConfig`. la-homelessness-youth first (no `prerender` keys at all),
   then gallerysonder (`handleHttpError: 'warn'` carries over; its five
   `$app/stores` imports move to `$app/state`, or every page throws), then
   alamo-anatomy (`prerender.origin` → the starter's `productionOrigin` and `siteOrigin`, not `paths.origin`,
   plus the svelte 5.57.1 bump).
5. **Every other kit 2 repo**, as Renovate reaches it under
   `group:allNonMajor`'s schedule. Bump `baseline-versions.ts` to kit 3 when
   more than half the fleet is on it, not before.

Until a repo is migrated its Renovate pair stays open and red. That is a rule
working, not a stuck PR: kit 3 is a major and does not automerge.

**Env vars across the six (_measured_).** Every `$env/*` read in the six repos
is `FORMS_INGEST_URL`, `FORMS_INGEST_TOKEN` or `PUBLIC_TURNSTILE_SITE_KEY`,
exactly what reddoor-starter#187's `src/env.ts` declares; other variables come
through `import.meta.env.VITE_*`, which kit's list does not filter. The
starter's `src/env.ts` therefore carries over unchanged, and its
`kit-config.test.ts` (undeclared reads, `$env/*` reads, `$app/stores`, no
`paths.origin`) is the
gate each site copies.

## 5. Follow-ups this plan does not do

- **`#lib` instead of `$lib`.** `alias` is deprecated; a codemod
  (`$lib/` → `#lib/`, plus `imports` in `package.json`) clears the warning. The
  starter has 113 `$lib/` imports.
- **The origin pieces as a shared helper.** `productionOrigin`, the `define`
  and `siteOrigin` are about 30 lines that each starter-shaped site copies; a
  `@reddoorla/maintenance` export would keep them from drifting.
- **`analytics-tag` on kit 3**: find the config through `vite.config.ts`, and
  accept `createKitConfig(` as the factory.
- **A kit 3 migration recipe** (`reddoor-maint kit-3 <site>`), if step 3 shows
  the same diff three times. Not before: the env declarations need a human to
  read what each site actually reads.

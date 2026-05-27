---
"@reddoorla/maintenance": minor
---

feat(recipes): `reddoor-maint init` — one-shot guided onboarding

Runs the full onboarding chain (`convert-to-pnpm → onboard → sync-configs → svelte-codemods → a11y-fixtures-page → audit`) in sequence against a site. Thin orchestrator — every underlying recipe still creates its own branch, so the operator ends up with a stack of `maint/<recipe>-<ts>` branches to PR. `noop` results continue the chain; first `failed` recipe or uncaught error short-circuits.

```bash
pnpm reddoor-maint init             # against cwd
pnpm reddoor-maint init ./my-site   # explicit path
pnpm reddoor-maint init --fleet airtable   # across the fleet
```

Also adds a new `a11y-fixtures-page` recipe (included in `init`'s default sequence) that writes a starter `src/routes/dev/a11y-fixtures/+page.svelte` if the route doesn't exist. The `lighthouse` and `playwright-a11y` configs both target this URL; newly-onboarded sites need the route to exist for either audit to pass. Template is intentionally generic (semantic landmarks + headings + a relative link) — operator edits to an existing page are never clobbered.

Library exports: `init`, `a11yFixturesPage`, `DEFAULT_INIT_STEPS`, `InitOptions`, `InitResult`, `InitStep`, `InitStepResult`.

Closes 0.9.x scope item: `reddoor-maint init` + bootstrap `/dev/a11y-fixtures` route (per [docs/superpowers/plans/2026-05-27-0.9.0-scope.md](docs/superpowers/plans/2026-05-27-0.9.0-scope.md)).

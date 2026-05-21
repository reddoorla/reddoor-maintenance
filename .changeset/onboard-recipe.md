---
"@reddoorla/maintenance": minor
---

Add `onboard` recipe + CLI command for first-time fleet enrollment.

After running `convert-to-pnpm` to get a site onto pnpm, the next missing piece was: how does the site actually get the deps it needs to run audits? Discovered during the espada pilot — running `sync-configs` against a site missing `@reddoorla/maintenance`, `@lhci/cli`, `@playwright/test`, or `@axe-core/playwright` would land template files that immediately broke at runtime.

`onboard` closes that gap. It:

- Adds `@reddoorla/maintenance` as a devDep at the current minor range (`^0.2.0`) if not present
- Adds the canonical audit deps (`@lhci/cli`, `@playwright/test`, `@axe-core/playwright`) at baseline versions
- Runs `pnpm install` with streaming output
- Commits the resulting package.json + pnpm-lock.yaml as one logical change

Idempotent: returns `noop` when everything is already declared. Refuses on dirty trees. Pre-flights for `pnpm-lock.yaml` and returns `failed` with `"run convert-to-pnpm first"` if absent.

CLI: `reddoor-maint onboard [site]` with `--audits lighthouse,a11y` to subset (default = both) and `--fleet <inventory>` for batch onboarding.

Library: `onboard(site, { audits?, packageVersion?, spawn? })` exported from the package.

### Recommended workflow for new fleet sites

```bash
reddoor-maint convert-to-pnpm /path/to/site   # if site is on npm/yarn
reddoor-maint onboard /path/to/site            # install deps
reddoor-maint sync-configs /path/to/site       # write canonical configs
reddoor-maint audit /path/to/site              # verify
```

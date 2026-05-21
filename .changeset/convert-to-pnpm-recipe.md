---
"@reddoorla/maintenance": minor
---

Add `convert-to-pnpm` recipe + CLI command to migrate npm/yarn sites onto pnpm. Also fixes canonical configs to use portable start commands.

### New: `convert-to-pnpm` recipe

For sites still using `package-lock.json` (or `yarn.lock`). Idempotent and branch-isolated like every other recipe:

- Detects `pnpm-lock.yaml` → returns `noop`
- Otherwise: removes `package-lock.json` + `yarn.lock`, pins `packageManager: "pnpm@<version>"` in `package.json`, rewrites `npm run X` → `pnpm run X` and `npx X` → `pnpm dlx X` in scripts, runs `pnpm install`, commits the resulting `pnpm-lock.yaml`.
- Three commits per applied run (lockfile removal, packageManager + script rewrites, new pnpm-lock).
- Returns `failed` (with the branch preserved for inspection) if `pnpm install` errors.

CLI: `reddoor-maint convert-to-pnpm [site]` or with `--fleet` for batch conversion.

Library: `convertToPnpm(site, { spawn?, pnpmVersion? })`.

### Fix: canonical configs use portable `npm run vite:dev`

Both `src/configs/lighthouse.ts` (`startServerCommand`) and `src/configs/playwright-a11y.ts` (`webServer.command`) previously hardcoded `pnpm vite:dev`. After sync-configs landed on an npm site, lhci and Playwright would fail to start the dev server. `npm run vite:dev` works on both pnpm and npm sites with no downside.

### Script rewriter is conservative on purpose

- Touches `npm run <name>` and `npx <token>` (identical semantics under pnpm)
- Skips bare `npm install`, hyphenated names like `npm-check-updates`, and concurrently's `"npm:scriptName"` shorthand

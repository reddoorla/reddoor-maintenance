---
"@reddoorla/maintenance": patch
---

Two real fixes surfaced by dogfooding 0.10.5 against caltex.

- **lighthouse**: `lhci@0.15+` no longer writes `manifest.json` — the audit was reading a stale filename and reporting "no manifest written" against perfectly healthy runs. The audit now scans `.lighthouseci/` for `lhr-*.json` files (which lhci does still write) and builds the manifest equivalent from each lhr's `requestedUrl` + `categories.X.score`.
- **a11y**: the synthesized playwright config lives in `/tmp`, and playwright's default `webServer.cwd` is the config file's directory — so `npm run vite:dev` was reading `/tmp/.../package.json` and ENOENT'ing before vite ever started. The synthesized config now pins `webServer.cwd` to the site's path.

Both were silent classes — masked by `manifest.json`-writing test mocks and a `webServer.cwd`-defaulting playwright config. Caltex dogfooding caught both on the first real audit run after 0.10.5 shipped.

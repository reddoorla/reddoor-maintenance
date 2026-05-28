---
"@reddoorla/maintenance": patch
---

a11y audit: write the spec/config directory inside `site.path` (not `/tmp`) so the spec's `import AxeBuilder from "@axe-core/playwright"` resolves via Node's walk-up to the site's `node_modules`. Same class of bug as the `webServer.cwd` fix in 0.10.6 — third layer of "the audit's working directory matters." Caltex 0.10.6 dogfood reproduced this in seconds; the manual fix-validation against caltex came back with `0 violations, 1 passed in 9.2s`.

---
"@reddoorla/maintenance": minor
---

a11y: the axe scan runs on a production build the audit makes itself (`npm run build && npm run preview`, with `VITE_REDDOOR_GATE_FIXTURES=1`), never on `vite dev` (#948). A site's `/dev` guard must let that build serve the fixtures (reddoor-starter's guard does); a guard that refuses every non-dev build fails the audit with a line naming the guard and the flag. `reddoor.gateServer` now decides only where the hydration smoke runs.

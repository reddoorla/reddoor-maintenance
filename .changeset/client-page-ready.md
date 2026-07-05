---
"@reddoorla/maintenance": minor
---

New `@reddoorla/maintenance/client` subpath: `whenPageReady()` and `prefersReducedMotion()` — load-aware page readiness for splash screens and intro overlays. Replaces the fleet's blind `setTimeout` splash timers with real signals (eager-image settlement, optional document load, caller-supplied promises) bracketed by a `minMs` floor and `maxMs` ceiling. Framework-free, SSR-safe, dependency-light (gated by smoke-dist like `./forms`).

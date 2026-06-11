---
"@reddoorla/maintenance": minor
---

feat(configs): `createSvelteConfig` composes the starter's richness. It now always injects the fleet's canonical `$components/$utils/$stores/$assets` aliases (a site can override per key or add its own), and gains two opt-in options: `csp` (`true` for the baseline Prismic+Vimeo policy, or `{ directives }` to extend it per-directive) and `placeholder` (`true` tolerates 404s during prerender for an un-wired clone). CSP and prerender tolerance are opt-in so adopting the helper never silently changes a site's behavior; an explicit `kit.csp` remains an escape hatch.

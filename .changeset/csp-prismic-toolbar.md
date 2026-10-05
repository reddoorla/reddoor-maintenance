---
"@reddoorla/maintenance": minor
---

The baseline CSP from `createSvelteConfig({ csp })` now admits the Prismic toolbar. `script-src` allows the toolbar's path, `https://prismic.io/prismic-toolbar/`, and the one html2canvas file its Share button loads, `https://html2canvas.hertzen.com/dist/html2canvas.min.js`. A new optional `prismicRepository` option adds that repository's `https://<name>.prismic.io` to `frame-src`, after any site override, so the toolbar's iframe loads; a site that unset `frame-src` gets one seeded from `child-src`, then `default-src`, as a browser reads it, so no frame it allowed is lost. With no `prismicRepository`, no Prismic host is framed. A name that is not one DNS label of letters, digits and hyphens is refused, because it is written into the policy. Matches the per-site fix in reddoor-starter#164.

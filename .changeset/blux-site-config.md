---
"@reddoorla/maintenance": minor
---

blux convert: emit site-config.json — the site chrome (navigation + footer)
the page-focused convert dropped. Parses the export's nested navigation tree
(top items with optional dropdown children + the resolved logo url) and the
footer (enabled social networks + the copyright line) into a render-side
config the Nav/Footer consume. Additive: a site with no navigation/footer
yields an empty config (the render keeps its logo-only bar and placeholder
footer). The nav logo — chrome, not on any page grid, so absent from the
scraped urlMap — resolves by reconstructing its CDN url. Proven on
composition: 6 nav items (2 dropdowns), resolved logo, 5 footer socials.

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
scraped urlMap — resolves by reconstructing its CDN url.

Footer social profile urls aren't in the export (Blux injects them at render
time from account config), so they're recovered from the scraped live footer:
each enabled network is matched to its profile link by host (subdomain-safe,
so `notfacebook.com` never matches). Proven on composition: 6 nav items (2
dropdowns), resolved logo, and all 5 footer socials linked
(facebook/twitter/instagram/pinterest/linkedin).

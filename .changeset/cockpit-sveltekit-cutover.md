---
"@reddoorla/maintenance": minor
---

The operator dashboard's pages are the SvelteKit cockpit (`cockpit/`), built and served by the dashboard's own Netlify site. `renderSiteDashboardHtml` and `renderCockpitHtml` are no longer exported: they were the string renderers for those pages, exported only so the dist smoke test could find them.

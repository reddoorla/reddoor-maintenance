---
"@reddoorla/maintenance": patch
---

The a11y audit runs on a site whose CSP has no `'unsafe-inline'` in `style-src` (#949). The generated spec injected its motion-freezing sheet with `page.addStyleTag`, a `<style>` element such a CSP refuses, so the call threw and the audit failed with no results. The sheet is now a constructed stylesheet adopted by the document, which CSP does not govern; the page's own CSP stays enforced for everything else the audit measures. When the spec writes no results, the summary now names the error Playwright printed to stdout (a plain `Error:`, a typed one such as `TypeError:`, or a test timeout), followed by what the web server wrote to stderr less npm's config warnings, so a port clash or failed build is still named (#905), and a missing browser after a Playwright upgrade reads `a11y: Playwright's browser is not installed (no <path>) — run \`npx playwright install chromium\` in the site`. Both still fail the audit.

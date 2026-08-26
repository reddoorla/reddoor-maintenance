---
"@reddoorla/maintenance": minor
---

Attach a print-designed PDF to the audit email.

The audit now renders `reddoorla.com/audit/{token}/print` to a PDF and attaches
it alongside the HTML sheet. That route is a document built for paper — flat,
with every section visible — rather than the interactive report, whose evidence
sits behind disclosures. Printing the interactive page would have produced a
leave-behind with half its content folded away, which is worse on paper than the
long version it replaced.

It waits for the network to settle before printing, so webfonts are loaded: a
fallback face baked into a client-facing PDF cannot be corrected after the fact,
because the file is already in somebody's inbox. Page geometry comes from the
document's own `@page` rule via `preferCSSPageSize`, so the stylesheet stays the
one place that decides it.

Best-effort by design. Rendering needs a live page and a headless browser, and
an attachment is not worth losing a delivered report over — every other stage in
this pipeline degrades rather than throwing, and this one matches. If the render
fails the email still goes with the link, and a warning records why. It also
needs a persisted token: with no stored report there is no page to print. The
browser is closed in a `finally`, so a wedged render cannot strand a chromium
process on the runner.

No new toolchain: the runner already installs Playwright's chromium for the
crawl, and this uses the same `@playwright/test` the crawl imports.

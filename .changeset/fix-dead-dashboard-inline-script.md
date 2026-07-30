---
"@reddoorla/maintenance": patch
---

the per-site dashboard's Approve button (and every other control on the page)
was dead — one escape sequence killed the whole inline script.

`b.title = data.blockers.join("\n")` was written inside `renderSiteDashboardHtml`'s
template literal, so the `\n` was consumed at BUILD time and emitted a real newline
into the served HTML — an unterminated string literal. The browser then refused to
parse the entire `<script>` element, so NOTHING in it attached: Approve, "Send
anyway…" (both override controls), Trigger Renovate, and the site-details selects
were all inert. The page looked completely normal — the button rendered enabled, the
preflight chip was green, and clicking simply did nothing, with no error surfaced
anywhere in the product.

Fixed by double-escaping so the browser receives `\n` (the tooltip still joins
blockers on real newlines — asserted). The explanatory comment avoids backticks for
the same reason: it too lives inside the template literal.

Guarded by a new test that extracts every inline `<script>` from every dashboard page
(site dashboard in both health-clean and health-red states, fleet cockpit, submissions
page) and compiles each with `new Function` — parse-only, no DOM. A single syntax error
in one of these blocks is never a partial failure, so nothing smaller than
"the whole block parses" is a useful assertion.

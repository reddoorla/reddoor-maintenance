---
"@reddoorla/maintenance": patch
---

Make the requireTurnstile canary reviewable from the dashboard. Spam reasons are
now visible text, not just a hover tooltip (which never fires on iPad/phone): the
auto-spam badge gains an inline reason chip (truncated past 3 tokens) and every
scored row gets a "Spam" row (score + full reasons) in the expanded detail block.
/submissions filtered to spam_auto or spam shows a per-reason facet summary above
the list (tokens normalized by stripping trailing :N counts) so
"turnstile-required-absent" bot tells separate from content-classifier hits at a
glance. The per-site "Spam screen (30d)" panel stops counting spam_auto/spam rows
as Delivered — those notifications were skipped — and adds an "Auto-filtered" row
for the spam_auto count in the window.

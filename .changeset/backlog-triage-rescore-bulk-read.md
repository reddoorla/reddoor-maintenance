---
"@reddoorla/maintenance": patch
---

Backlog triage tooling for the pre-tuning submissions pile-up. New `submissions rescore` CLI re-runs the CURRENT spam classifier (turnstile "unverifiable") over every status='new' row — dry-run table by default, `--apply` re-buckets rows scoring >= SPAM_THRESHOLD to spam_auto with the new score/reasons plus a `retro-rescore` marker. The /submissions page gains a bulk "Mark all N filtered as read" action: a confirm-gated POST back to the page handler that flips every still-'new' row matching the current filter to 'read' server-side (`markFilteredAsRead`); spam and operator-touched rows are never affected by either path.

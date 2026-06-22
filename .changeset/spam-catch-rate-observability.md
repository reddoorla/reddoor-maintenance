---
"@reddoorla/maintenance": minor
---

Spam catch-rate is now observable. The honeypot/timing screen runs on each fleet site and silently
drops bots before they reach the dashboard, so the catch count was invisible. The site form helpers
now fire a best-effort, no-PII screen-out beacon (`{ screenOut: honeypot|too-fast }`) to the existing
ingest endpoint when they reject a submission; the ingest routes it to a compact per-site/per-day
`Spam Screenouts` bucket. Marking a submission "spam" increments the same bucket's `Marked spam`
counter. The per-site page gains a "Spam screen (30d)" panel (caught honeypot/too-fast, delivered,
marked spam) and the cockpit gains a one-line fleet roll-up (caught + through) — so you can tell a
weaker screen (rising _through_) from more exposure (rising _caught_, steady _through_). Counts are
approximate under high concurrency (the read side sums duplicate same-day buckets); the beacon never
throws and is abort-bounded (~1.5s), so the real-human clean path is never delayed and a hung beacon
on a screened submit waits at most the timeout.

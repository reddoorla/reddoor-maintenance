---
"@reddoorla/maintenance": patch
---

Structural anti-spray spam signals: cross-site repeat-sender detection, near-duplicate body detection, and retroactive re-bucketing.

Live analysis showed the biggest residual spam classes evade per-message content scoring: template sprays with per-site substitution (the dog-harness spray differed only in greeting; SEO sprays swap the target domain), the same sender blasting multiple fleet sites, and the first copy of every spray being delivered by design. Three new ingest signals close those gaps:

- `findRecentDuplicateSubmissions` replaces the exact-only `countRecentDuplicateMessages`: bodies are normalized in JS (full-Unicode lowercase; URLs/emails/domains/digit-runs stripped) and matched both exactly (>= 40 normalized chars) and by token-set Jaccard >= 0.9 (both sides >= 25 tokens, so short genuine messages never collide). Exact hits keep the `duplicate-body` reason; near-dupes get `similar-body`.
- `listRecentSubmissionsForEmail` powers the cross-site repeat-sender signal: the fleet's sites are unrelated businesses, so one email contacting 2+ different sites within 30 days is a solicitation tell → `spam_auto` with reason `repeat-sender`. Same-site repeats (genuine follow-ups) never trigger.
- `markSubmissionsSpamRetro` re-buckets prior still-`new` copies once a later copy identifies the spray (`retro:repeat-sender` / `retro:duplicate-body` appended to any existing reason). The `status = 'new'` guard is load-bearing: rows the operator already read/replied/marked are never touched.

All three are best-effort and fail-open (a lookup failure never blocks a lead), and everything lands in the recoverable `spam_auto` bucket — never a hard reject.

---
"@reddoorla/maintenance": minor
---

The dashboard's pending-report rows now tell the whole approval story: the
resolved recipients exactly as the send path computes them (To override →
point of contact, plus the forced ops CC), a draft-time preview link to the rendered
email (labeled as such — send re-renders with current Commentary) (or "no preview yet"), and when an approval actually goes out — the next
09:23 UTC daily run, with an hours countdown. Approve was the
highest-stakes, most information-starved click on the dashboard (operator
approve-loop UX memo, proposal 1); it now shows what it sends, to whom, and
when.

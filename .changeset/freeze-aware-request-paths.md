---
"@reddoorla/maintenance": patch
---

Make the request-path mirrors freeze-aware, and gate that they stay so
(2026-08-26 review, MED-9 / MED-13 / LOW-1).

The review asked whether anything enforces that a new mirror factory honours the
freeze switch. Answering it turned up something better: **four writers had already
skipped it, and none of them was a factory.**

`approve-report`, `report-commentary`, `resend-webhook` and `site-details` do not
use the mirror factories at all. Each calls `mirrorReportPatch` / `mirrorSiteField`
directly, inside its own hand-rolled `try { … } catch { console.error }` — four
independent copies of the swallow, each carrying a comment saying the hourly sync
converges it. Searching for `TURSO_IS_AUTHORITATIVE` could never find them,
because the defect is precisely that they never mention it.

**That comment stops being true at the freeze.** With the import stopped, a
swallowed mirror failure on an approve, a commentary edit, a delivery-status
webhook or a site-detail edit is permanent divergence: the Airtable write it
shadows has already succeeded, and the only trace is a log line nobody greps.

`mirrorWrite(label, run, strict = TURSO_IS_AUTHORITATIVE)` now owns that decision
in one place, and all four route through it. Under `strict` the failure is raised
with the label of the write that was lost, rather than logged and forgotten.

**The lockstep gate** discovers every file calling a `mirror*` writer and requires
it to use `mirrorWrite` or be listed as exempt with a reason — the same shape as
the query-plan classification gate. Exemptions are checked for staleness (a dead
entry silently re-excuses a future writer) and the discovery itself has a vacuity
guard, so the gate cannot pass by finding nothing.

**Ingest rate limiting: measured, not changed.** Three consecutive reviews flagged
that `aggregateBy: ["ip"]` cannot throttle an abusive visitor, and none recorded a
number. Traffic is server-to-server, so per-IP genuinely buys nothing against a
visitor — but the standing worry was the other direction, that a legitimate burst
trips 120/min and a real lead 429s. Against live data that is not close: across
the whole fleet since ingest went live (356 submissions, 2026-06-15 → 08-26) the
**busiest single minute ever is 4**, and the busiest day is 25. Netlify's
`rateLimit` still cannot key on a path param, so per-slug means an
application-level counter — a read on the one path where latency and failure modes
cost actual leads. Not worth it for a bound nothing has approached. The
measurement and an explicit revisit trigger (~40/min) are now in the code, so the
fourth review does not re-derive it.

**`.worktrees/` is gitignored.** The concurrent-session rule makes a worktree per
branch the norm here, so it is permanent furniture — and while untracked it was
the only entry in `git status`, which trains the eye to ignore a dirty tree.

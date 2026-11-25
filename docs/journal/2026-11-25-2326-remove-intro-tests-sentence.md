# 2026-11-25 — Maintenance reports: the "last items" sentence comes out

Follow-up to reddoorla/reddoor-maintenance#2293 (`9298f4d3`), before it is released. Decision: reddoor-workspace `decisions/2026-11-25-2012-remove-testing-upsell-signoff.md`.

**Why.** #2293 added "The last items are tested automatically every night." after the intro over MAINTENANCE CHECKS, on the operator's pick at about 2:50pm PT. On the 3:06pm [TEST] he wrote, relayed by the parent session at 3:22pm PT: "issue with the email, 'last items' is not specific in context, just remove that sentence". His reply crossed the landing: #2293 merged at 3:23pm PT, a minute after it was sent and before this session read it. No release had carried the sentence, so no client has seen it.

**What changed.** The `maintenanceTestsNote` copy field and the template logic that appended it are removed; `copy.ts` and the template are byte-identical to `014a3d30`, the head before the sentence. The Testing rows at the end of the list stay. The sentence's five tests are replaced by one that pins the intro as the plain default intro with nothing after it. Two mutations went red: the sentence put back, and any text appended to the intro.

**Beliefs corrected on contact.** A sign-off answered in AskUserQuestion is not the last word on client copy: the copy he picked in the abstract read wrong to him in the rendered email. The [TEST] is the sign-off; a decision is a draft until he has seen it rendered.

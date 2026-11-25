# 2026-11-25 — Maintenance reports: the blurred testing upsell becomes an AEO/SEO block, and the nightly tests join the checklist

Landed in reddoorla/reddoor-maintenance#2293 (branch `claude/remove-testing-upsell`). Brief: reddoor-workspace `briefs/2026-11-25-remove-testing-upsell/worker-brief.md`. Decision: reddoor-workspace `decisions/2026-11-25-1835-remove-testing-upsell-aeo-seo-block.md`.

**Why.**

- The operator, after reading a [TEST] Reddoor report: "i think we need to remove the testing upsell". The upsell was a blurred image of a checklist, linked to info@.
- Tim, `#website-maintenance` 10:20am PT: "Yes let's replace with the AEO/SEO upsell. Then include all the testing check boxes now". The operator: "yes our tests".
- The operator's correction: the AEO/SEO thing is the goal tracking discussed with MSOT. That is P1-128, the analytics scorecard, which has no page or price yet.

**What a Maintenance report now shows.**

- The upsell's slot holds an "AI SEARCH & SEO" block: a call to action for the scorecard that names the site and links to `mailto:info@reddoorla.com` (pick (a)).
- The MAINTENANCE CHECKS list goes on with the seven Testing rows, each only when its nightly test passed.
- That second part changed mid-session: a separate TESTING section was built first, then the operator said: "instead of a new section, just add all the tests to the maintenance section".
- A row that did not pass is left out (pick (a)).
- Testing reports are unchanged.

**The mapping was already in the code.** `auto-tick.ts` had an evidence function for every Testing row: the browser audit for desktop, mobile, links and titles; form-e2e; smoke; and default-branch CI. It ran only for Testing reports. The new `evidenceItemsFor` gives Maintenance reports the same evidence. It is non-gating, so an unmeasured row is omitted rather than `unknown`, and `checklistFor` and `gatingFields` are unchanged.

**Measured** (read-only Turso, 10:28am PT): all 17 maintained sites pass every Testing row. Form Functionality is `n/a` for three sites with no form: 29 Navy, CalTex and Williamson Homes.

**Defects the review found** (round 1, Opus, three lenses):

- **Major: a stale tick.** Evidence is frozen at draft, up to 7 days before the send, and an approved row is never re-ticked. So a client could see "passed its latest run" over a pass a week old. Fixed at render: a Testing row shows only when its pass is within 3 days of the email's date.
- **Minor: Testing checkboxes ticked on Maintenance rows.** The draft and retick tick loops also ticked `Test:` checkbox columns on Maintenance rows. Both loops are now limited to `checklistFor`.
- **Minor: the intro over-claimed.** It said "every night" and "after every update" for checks that are not all nightly. That intro went with the merge into the maintenance list.

**Beliefs corrected on contact.**

- The test probe `>TESTING</mj-text>` matched nothing, because the template renders to HTML, not MJML. My first two "is absent" assertions were vacuous until a positive test failed on that same string.
- The Reddoor draft the brief named, `report_01M89X5A2PFMMPTCBYWC57T5PQ`, had been sent at 9:56am PT, so `--rerender` was refused.
- The [TEST] went through `testSendReport` with the CLI's own binding. Its render layered live Testing-row evidence onto that row in memory. Nothing was written to `reports`.

**Not done here.** Maintenance reports drafted or approved before this deploys carry no Testing evidence, so they go out with the AEO block and the six maintenance rows only. An unapproved one gains the rows on its next refresh.

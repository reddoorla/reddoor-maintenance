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

**The mapping was already in the code.** `auto-tick.ts` had an evidence function for every Testing row: the browser audit for desktop, mobile, links and titles; form-e2e; smoke; and default-branch CI. The new `passedAutomatedTests(site, now)` runs those same rules when the email is built. It is never stored, and the Maintenance checkboxes and send gate are unchanged.

**Measured** (read-only Turso, 10:28am PT): all 17 maintained sites pass every Testing row. Form Functionality is `n/a` for three sites with no form: 29 Navy, CalTex and Williamson Homes.

**Defects the reviews found** (Opus, three lenses):

- **Round 1, major: a stale tick.** Evidence was saved at draft, up to 7 days before the send, and an approved row is never re-ticked, so a client could see a pass a week old. The first fix filtered saved passes to within 3 days of the email's date. It also limited the draft and retick tick loops so they no longer ticked `Test:` checkbox columns on Maintenance rows.
- **Round 2, two majors on that first fix.**
  - Measured against the due date, the age check had no lower bound, so a late send still showed old passes. A future timestamp always passed.
  - On the normal path the rows would almost never show. The nightly drafts 7 days before the due date, so every saved pass was already too old.
- **The fix after round 2 (`f5317dc9`) replaced the design rather than patching it.** The rows are read from the site row when the email is built. The send uses its own send time, the draft preview uses the draft time, and selftest uses its own. Stored evidence and the tick loops are back to main.

- **Round 3, on `f5317dc9`, one major, in the tests.** Correctness and client output found nits and minors only; the tests lens found the gaps. Replacing the draft's `passedAutomatedTests(siteRow, completedOn)` with `[]` left all 1063 report tests green, so the cockpit preview could lose the Testing rows unseen. Minors, folded: the selftest path (`report-data.ts`) was unpinned the same way; the send's `new Date()` could run 2 days late and stay green, because the fresh fixture pass was 1 hour old (now 2.9 days, with a 3.1-day case left out); a per-site `testingChecklist` override was untested; the changeset described a TESTING checklist that no longer exists. Each new test went red on its mutation. The blank-site-name CTA ("How does  show up…") needs a code change and a test, so it is filed as #2294. The fixes touched tests and the changeset only; `src/` is unchanged from `f5317dc9`.
- **Round 4, on round 3's fix (`e0a963d7`), clean.** One Opus reviewer, three lenses, the commit alone. Every new test went red on its mutation, and a fresh one (the send's now a day early) turned the 3.1-day case red, so the window is pinned from both sides. One minor, folded: the draft test said "inside MAINTENANCE CHECKS" but only checked "after its heading"; it now also checks the row comes before the AI SEARCH & SEO heading.

**The operator's sign-off** (decision `2026-11-25-2012-remove-testing-upsell-signoff.md`, about 2:50pm PT): the 11:36am [TEST] render signed off, and the intro gets a sentence. On a Maintenance report whose list ends with Testing rows, "The last items are tested automatically every night." follows the default intro. It is a separate copy field, `maintenanceTestsNote`, because the announcement email reuses `maintenanceIntro` and follows it with "We do this quarterly", which would contradict "every night". No site overrides the intro (`copy_intro` empty on every row). Five mutations, named first, each went red: never rendered; rendered with no Testing row; rendered on a Testing report; folded into the shared default; placed before the intro. The first run of them was void: my restore step (`git checkout -- <files>`) also reverted the uncommitted implementation, so three of the seds matched nothing and "went red" only because the feature was gone. Committing first and checking each mutation's diff-stat fixed that.

**Beliefs corrected on contact.**

- The test probe `>TESTING</mj-text>` matched nothing, because the template renders to HTML, not MJML. My first two "is absent" assertions were vacuous until a positive test failed on that same string.
- The Reddoor draft the brief named, `report_01M89X5A2PFMMPTCBYWC57T5PQ`, had been sent at 9:56am PT, so `--rerender` was refused.
- The [TEST] went through `testSendReport` with the CLI's own binding. Its render layered live Testing-row evidence onto that row in memory. Nothing was written to `reports`.

**Effect on reports already queued.** None needed: the send reads the nightly results itself, so reports drafted before this lands show the Testing rows too.

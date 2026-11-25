# 2026-11-25 — LEADS counts only real leads

Landed in the PR from `claude/leads-production-only`, closing [reddoorla/reddoor-maintenance#2296](https://github.com/reddoorla/reddoor-maintenance/issues/2296). It follows up P1-127 (reddoorla/reddoor-maintenance#2290). The worker was started from the 11-25 cockpit card.

**Why.** At 10:20am PT in `#website-maintenance`, Tim asked why the 11-25 Reddoor report said "5 Leads, New this period (0 last period)". The real count was 0. Of the five rows:

- two were 11-03 Turnstile proofs on `staging.reddoorla.com/medtech`, sent from `example.com`;
- two were the 11-10 Meta Pixel set-up test on `reddoorla.com/medtech`, sent from `t@c.v`;
- one was an 11-17 vendor pitch the spam filter missed.

`listLeadTimestampsForSite` filtered on status and form type only, and never looked at where a submission came from.

**Measured before deciding** (Turso, SELECT-only through `openReadOnlyDb` + `assertReadOnly`, 2:58pm PT):

- **Coverage.** 913 submissions, 557 non-spam. **None of the 557 lacks a `source_url`**, so the brief's first fork ("does a missing URL count?") did not arise. A missing or unparseable URL simply does not count.
- **Off-production rows.** Seven non-spam rows are off a production host, and all seven are tests: five on `*.netlify.app` (a Hedloc deploy preview, Vida, Roalson, Mantis and Williamson pre-domain hosts) and the 11-03 staging pair.
- **Spam rows.** Among spam rows, 32 are on other hosts and 10 on `localhost`. All are already excluded by status.
- **Production-host test senders.** Of the 244 production-host, non-spam, non-signup rows, 4 come from `@reddoorla.com` (Vida 9-29, Hedloc 11-10 ×3) and 2 from `t@c.v` (Reddoor 11-10). Two August Beachfront "Test Submission" rows use real domains (`m.com`, `t.co`), and no domain rule reaches them.
- **The form-e2e probe** stores nothing (`testMode` is dropped at ingest), so it leaves no marker to match.

**The rule.** A lead is `isCountedLead` (`src/reports/lead-periods.ts`). It is not spam, is a lead form, came from the site's own apex or `www` page (`isProductionSource`, built on the `siteHostnames` pair the GA report query already filters on, matched exactly and never by suffix), and was not sent by a test sender (`isTestSender`). A test sender is Reddoor's own domain, `example.com`/`.org`/`.net`, the reserved `.test`/`.invalid`/`.localhost`/`.example` TLDs, or a one-letter TLD. The sender rule was the brief's second fork. The operator picked (a), the domain-only rule, at about 3:18pm PT (workspace `decisions/2026-11-25-2259-leads-sender-test-rule.md`). It matches the domain only, never a name.

**Corrected on contact.** The brief listed two places that define a lead: `listLeadTimestampsForSite` and `countSubmissionsSinceBySite`. There was a third: the snapshot-derived site page (`src/dashboard/snapshot-views.ts`) filters the snapshot's rows through its own `isCountedLead`. The cockpit parity test caught it, showing the snapshot path at 132 leads against the loader's 0. All three now call the one function.

**Left as it is (defaulted, fork iii).** `readLeads` (fleet-daily) and the fleet cockpit's `newLeads` count rows by status for triage, all time and including spam. They are not the report's metric, and a staging row still needs reading. Workspace `decisions/2026-11-25-2259-leads-triage-counts-defaulted.md`.

**Mutations** (each turned a test red): dropping the host filter (7 failing), matching the host by suffix (6), treating `www` as non-production (7), dropping the sender rule (4), and matching the sender domain by bare suffix (1).

**Not done in code.** The 11-17 vendor pitch (`office@animaticlogo.com` on `reddoorla.com/contact`) is still a lead until someone marks it spam on `/s/reddoor`. Once that is done, Reddoor's 30-day count is 0.

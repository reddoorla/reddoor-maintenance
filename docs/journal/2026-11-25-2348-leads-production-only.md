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

**Review round 1** (three Opus lenses: wiring, edge cases, tests and language) was dirty, with four real defects, all fixed in this PR:

- **The snapshot's text budget could undo the rule.** Once the cockpit snapshot's 1.5 MB lead-text budget is spent, older rows' `sourceUrl` became a marker and long emails lost their domain. The snapshot page would then undercount leads, or count a test sender, against Turso. It is latent today (about 0.2 MB of text). Past the budget, a row now keeps its source page's origin and its email's domain behind the 80-character prefix.
- **A site `url` stored without a scheme silently zeroed every lead.** GA goes unfiltered in that case, so the site would read as busy with no leads. It is now read as `https://`. Measured: 47 sites, none stored that way; two `external` sites have no url at all.
- **The digest wiring was untested.** Every `runDigest` test injects its counts, so passing an empty URL map would have zeroed every digest lead with every test green. A test now runs `fetchSubmissionsDigestCounts` against a seeded file database.
- **The form-e2e control's digest column no longer told marked from unmarked.** It now asserts the digest's whole row for the site: present with 0 leads unmarked, absent marked.

The minors were folded in too: a trailing root dot on a host or email domain (`bob@gmail.com.` read as a test sender), the parity fixture's mixed-case `Example.COM` email restored, a non-vacuous parity check (Acme has leads on both paths), and stale "the digest's lead rule" wording.

**Consequences, stated rather than changed:**

- The rule compares against a site's _current_ `url`, so a site that moves domain stops counting leads from its old one, in history too.
- The digest's fleet total no longer counts leads for a `site_id` missing from the roster; its signups and auto-spam still count.

**Mutations** (each turned a test red): dropping the host filter (7 failing), matching the host by suffix (6), treating `www` as non-production (7), dropping the sender rule (4), and matching the sender domain by bare suffix (1). After round 1, five more: the snapshot budget dropping the origin (1) or the email domain (1), no `https` fallback for a scheme-less site url (1), the digest given no site urls (1), and a trailing root dot kept (2).

**Not done in code.** The 11-17 vendor pitch (`office@animaticlogo.com` on `reddoorla.com/contact`) is still a lead until someone marks it spam on `/s/reddoor`. Once that is done, Reddoor's 30-day count is 0.

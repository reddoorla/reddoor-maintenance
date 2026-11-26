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

**Corrected on contact.** The brief listed two places that define a lead: `listLeadTimestampsForSite` and `countSubmissionsSinceBySite`. There was a third reader. The snapshot-derived site page (`src/dashboard/snapshot-views.ts`) filters the snapshot's rows through `isCountedLead`, which held the same rule as the SQL but in a second place. Changing only the SQL left that path on the old rule, and the cockpit parity test caught it: 132 leads on the snapshot path against the loader's 0. The rule now lives only in `isCountedLead`, which takes the site's url, and all three call it.

**Left as it is (defaulted, fork iii).** `readLeads` (fleet-daily) and the fleet cockpit's `newLeads` count rows by status for triage, all time and including spam. They are not the report's metric, and a staging row still needs reading. Workspace `decisions/2026-11-25-2259-leads-triage-counts-defaulted.md`.

**Review round 1** (three Opus lenses: wiring, edge cases, tests and language) was dirty, with four real defects, all fixed in this PR:

- **The snapshot's text budget could undo the rule.** Once the cockpit snapshot's 1.5 MB lead-text budget is spent, older rows' `sourceUrl` became a marker and long emails lost their domain. The snapshot page would then undercount leads, or count a test sender, against Turso. It is latent today (about 0.2 MB of text). Past the budget, a row now keeps its source page's origin and its email's domain behind the 80-character prefix.
- **A site `url` stored without a scheme silently zeroed every lead.** GA goes unfiltered in that case, so the site would read as busy with no leads. It is now read as `https://`. Measured: 47 sites, none stored that way; two `external` sites have no url at all.
- **The digest wiring was untested.** Every `runDigest` test injects its counts, so passing an empty URL map would have zeroed every digest lead with every test green. A test now runs `fetchSubmissionsDigestCounts` against a seeded file database.
- **The form-e2e control's digest column no longer told marked from unmarked.** It now asserts the digest's whole row for the site: present with 0 leads unmarked, absent marked.

The minors were folded in too: a trailing root dot on a host or email domain (`bob@gmail.com.` read as a test sender), the parity fixture's mixed-case `Example.COM` email restored, a non-vacuous parity check (Acme has leads on both paths), and stale "the digest's lead rule" wording.

**Review round 2** (three fresh Opus lenses) was dirty again, and both majors were in round 1's own snapshot fix:

- **All three lenses found an inverted condition in `emailPastBudget`.** An address whose `@` fell within the first 80 characters lost its domain, so the snapshot and Turso disagreed in both directions. For example, `a@` + 90 characters + `.example.com` was counted in the snapshot.
- **The size bound had weakened.** Keeping up to 253 arbitrary characters let a crafted row cost about 2.4 times as much: about 3.5 KB a row, so roughly 1,300 posts instead of 3,100 to reach the 6 MB page limit.

The fix keeps, past the budget, exactly what decides the verdict, in bounded ASCII:

- **Email:** the domain when it is a plain host. Otherwise a stand-in with the same `isTestSender` verdict: `invalid` (a reserved TLD) or no domain.
- **Source page:** `https://<host>` for an http(s) page on a plain host, else the marker.

The two sides now agree by construction, and a kept field costs at most 253 bytes beyond the prefix the row already kept.

The round-2 minors were folded in too:

- `isProductionSource` counts only an http(s) page (`blob:https://client.com/` and `foo://` were counted in Turso).
- A site url like `client.com:8080`, which parses as a scheme, is retried as `https://`.
- Every trailing root dot is stripped, so `bob@gmail.com..` is no longer a test sender.
- `listLeadTimestampsForSite` filters spam in SQL again, so it does not read spam rows' text.
- The digest's orphan-site comment now says what the code does.

Mutation 14 (dropping an "empty host" check) survived, which proved the check dead: an http(s) URL that parses always has a host. It was removed.

**Consequences, stated rather than changed:**

- The rule compares against a site's _current_ `url`, so a site that moves domain stops counting leads from its old one, in history too.
- The digest's fleet total no longer counts leads for a `site_id` missing from the roster; its signups and auto-spam still count.

**Mutations** (each turned a test red): dropping the host filter (7 failing), matching the host by suffix (6), treating `www` as non-production (7), dropping the sender rule (4), and matching the sender domain by bare suffix (1). After round 1, five more: the snapshot budget dropping the origin (1) or the email domain (1), no `https` fallback for a scheme-less site url (1), the digest given no site urls (1), and a trailing root dot kept (2). After round 2: any scheme counting (1), no stand-in for an odd test domain (1), round 1's inverted email condition restored (1), and only one trailing dot stripped (1).

**Not done in code.** The 11-17 vendor pitch (`office@animaticlogo.com` on `reddoorla.com/contact`) is still a lead until someone marks it spam on `/s/reddoor`. Once that is done, Reddoor's 30-day count is 0.

**Review round 3** (a continuation session, three fresh Opus lenses on the same split, run on the branch with `main` merged in) was dirty again. It found two majors and one reproduced parity gap, and all of them are fixed:

- **Two snapshot branches had no test** (tests lens, by mutation). Making the email stand-in always `invalid` kept 213 tests green, and so did deleting the http(s) check in `originPastBudget`. A Unicode or space-padded real address (`bob@münchen.de`) takes the first branch, so a regression would have dropped real leads from the snapshot's count without a test noticing. New rows now pin both: `a@<<<….gmail.com` keeps `a@`, and a `foo://` page keeps the marker.
- **The 20,000-character cut was still in budget** (wiring lens, reproduced with tsx). Round 2 made only the past-budget branch keep what the verdict reads. Inside the budget, a field over `SNAPSHOT_FIELD_MAX` was still cut mid-text. `"x"×20,500 + "@example.com"` lost its `@` and counted as a lead in the snapshot, though Turso called it a test sender. A long userinfo in front of `@client.com` lost its host the other way. Ingest's `EMAIL_RE` has no length cap. Both fields now take their past-budget form whenever they are cut. The field-cap test now expects that form for those two fields: the one assertion changed, following the new behaviour.

Two minors were folded in:

- **The `@` is now kept when the email's domain is dropped.** A local part that held its own `@` was being read as the address: `x@reddoorla.com@<<` was counted in Turso and not in the snapshot.
- **`isTestSender` strips trailing ASCII punctuation, not only dots.** `test@example.com,` and `staff@reddoorla.com>` pass `EMAIL_RE`, and both were counted as leads.

Two nits were folded in:

- **`_` is allowed in `PLAIN_HOST`.** The URL parser accepts it in a host, so `my_site.com` kept its leads in Turso but lost them in the snapshot.
- **Wording.** A stale "origin" comment and variable name, and the changeset's `example.*`, which now reads `example.com`/`.org`/`.net`.

Mutations after round 3, each red: dropping the in-budget special case (1), the old "no domain" return (1), the stand-in always `invalid` (1), no http(s) check in the snapshot (1), no `_` in `PLAIN_HOST` (1), and stripping only dots from the domain (1).

**Left as a note.** The reserved test TLDs in other scripts (`.テスト`, punycoded `xn--zckzah`) are not test senders. That is outside the operator's pick (a) list.

**One more consequence.** A report approved but not yet sent keeps the LEADS figure it was drafted with, because `refreshLeads` returns early once a report is approved. That is the existing lock, and it is not changed here.

**Review round 4** (three fresh Opus lenses, on round 3's fix) was dirty. It found one major and one reproduced gap, and both are fixed:

- **Round 3's in-budget fix had no regression test on a real address or URL** (tests lens). The field-cap test feeds `"x"×1,000,000` to every field, so it never reaches an `@` or a host. Two mutations stayed green: dropping the domain from the in-budget email, and marking the in-budget page instead of keeping its host. Round 3's mutation line above overstated it: "dropping the in-budget special case" went red only because the marker and the prefix look different. A new test now cuts `"x"×20,500 + "@example.com"` and a page with a 20,500-character userinfo in front of the site's host. It checks the kept text, and that `isCountedLead` gives the same verdict on the kept row as on the full one.
- **Non-ASCII trailing punctuation still counted a test sender** (edge-cases lens, reproduced). Each of these passes ingest's `EMAIL_RE` and was counted:
  - `test@example.com”`, a smart quote pasted from Mail or Word;
  - a full-width comma;
  - a CJK full stop;
  - a zero-width space;
  - `test@example.com ,`, where the trim ran before the strip. (Round 5 corrected this one: it fails `EMAIL_RE`, which allows no space, so no stored row can hold it.)

  The strip now removes any trailing Unicode punctuation, symbol, separator, format character or space.

Folded in too:

- **An address literal is not read as a domain.** `bob@[1.2.3.4]` had become a "one-letter TLD" once `]` was stripped.
- **New tests pin the rest of the strip's character class.** `]` and `}` were untested ranges.
- **An `http://` page past the budget is now tested.** It keeps its host, as Turso counts it.
- **The changeset names `.example` and the punctuation rule.**

The wiring lens ran 16,192 grid cases and 400,000 random ones through the real rule and a copy of the snapshot code. It found no mismatch for any real host. Its one minor is filed as reddoorla/reddoor-maintenance#2300: since round 3, an email or page over 20,000 characters keeps only its verdict-keeping form, so search and display lose the rest. No count changes. Two nits are noted there too: sub-delimiter characters in a host, and the in-budget branch over-charging the budget.

Mutations after round 4, each red:

- the in-budget email losing its domain (1);
- the in-budget page marked (1);
- no `\p{P}` in the strip (3);
- no `\p{S}` (1);
- no `\p{Cf}` (1);
- no space classes (1);
- no address-literal check (1);
- `https:` only in the snapshot (1).

**Review round 5** (three fresh Opus lenses, on round 4's fix) was dirty by the rule that a reproduced behaviour defect is never a minor. That makes five dirty rounds, the stop.

- **The defect** (edge-cases lens, reproduced again on the committed code). An emoji after a test address stopped the strip: `test@example.com❤️` and `test@example.com✔️` pass `EMAIL_RE`, and they still counted as leads. The emoji's variation selector (U+FE0F) is a combining mark, which the class did not hold, so the strip halted at it. A comma carrying a combining accent did the same. It takes a tester typing an emoji after a test address on a form whose field is not `type=email`.
- **The fix**, folded in before asking. A combining mark is stripped together with the punctuation or symbol it follows, and never after a letter, so an IDN TLD that ends in a mark (`.हिन्दी`) keeps it and stays a real sender. Removing the mark from the pattern turns a test red.
- **The wiring lens found nothing.** It ran 13.8 million fuzz cases with no mismatch between the snapshot's kept email and the full one. Its negative control (a broken stand-in) found 5,053.
- **The tests lens found two minors, both folded in.** Round 4's journal claimed `test@example.com ,` passes `EMAIL_RE`; it does not, and that line is now corrected in place. The changeset now names the address-literal rule and every stripped character class.
- **Its two nits are noted, not acted on.** `\p{Z}` and `\s` overlap, and the strip-before-trim order cannot be told apart by any input ingest accepts.

**Process note.** The round-5 tests lens ran its mutations in the shared worktree while the other two lenses read it. The wiring lens noticed, and re-ran against `git show HEAD:` copies. The edge-cases finding was then re-checked against the committed code. A later round should give the mutating lens its own copy.

Per the stop rule, the PR went to the operator with a decision file. Workspace `decisions/` holds it, under the time of the ask.

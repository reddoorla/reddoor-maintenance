# 2026-11-25 — P1-127: leads by period, and a Reddoor contact on every report

Landed in the P1-127 PR from `claude/p1-127-leads-periods-reddoor-contact`, closing [reddoorla/reddoor-maintenance#2286](https://github.com/reddoorla/reddoor-maintenance/issues/2286). Built by one session and finished by a second, which picked up at the 300k-token seam after review round 2.

**Why.** On Mon 11-23 in `#website-maintenance`, Tim asked for two things. The first was leads filtered by time ("the last 30 days ... or month over month") against all time. The second was a Reddoor person on every client report, so a reply to a report reaches the team even when a client's Report recipients override drops the point of contact. That override is how Roalson's reports go out. The operator settled both in the workspace's `decisions/2026-11-24-1950-p1-127-leads-periods-and-reddoor-contact.md`:

- **Leads** go on the dashboard **and** the client report.
- **The Reddoor contact** is a per-site field, sent as **CC**, so no To override can remove it.

**What changed.**

- **Contact column.** `sites.reddoor_contact` (migration 0064, add-only) is edited in Site details.
- **One recipient rule.** `reportRecipients()` is now shared by the send, the approve gate and the cockpit's pending line. To is unchanged. CC is the per-site CC, then the contact, then info@, each listed once.
- **Approve gate.** It warns when the contact is empty and fails when it is malformed. The check is not in `launch-check`.
- **Leads periods.** `leadPeriods()` is pure. It uses the digest's lead rule over the last 30 complete Pacific days, the 30 before them, six complete months and all time.
- **Where leads show.** The site page has a Leads panel. `/submissions` has "Since <date>" links. Maintenance and Testing reports have a LEADS block after ANALYTICS. Its counts are captured at draft (0065, 0066), refreshed on a pre-approval re-render, and frozen at approval, as GA is. A failed read leaves the block out rather than printing 0.

**Mutations, each red.**

| Mutation                                | Tests that went red                                                    |
| --------------------------------------- | ---------------------------------------------------------------------- |
| Shift the 30-day window by one day      | 3                                                                      |
| Swap two months                         | 2                                                                      |
| Swap current and previous in the report | 1                                                                      |
| Let To drop the contact                 | 3, two of them through the real send path with a capturing Resend fake |

**Review: three rounds, Opus.**

- **Round 1** was dirty. A sed aimed at the leads panel had also changed the pressed state of the Approve and Override buttons. Separately, the `/submissions` links claimed the panel's window, but that filter compares a Pacific date with stored UTC times. Both were fixed. The minors are filed as #2287 and #2288.
- **Round 2** was dirty. The contact check sat in `recipientFindings`, which `launch-check` also uses, so an empty contact would have held every launch until it was seeded. It now lives in `approveBlockers` only, and a launch-check case pins this.
- **Round 3** was clean.
  - One doc minor was folded in: the lead windows equal ANALYTICS's windows only when the GA property reports in Pacific time, because GA cuts days in the property's own zone.
  - The rest went to #2289: no test pins the two lines in `render-from-row.ts` that carry the stored counts into the sent email, and the re-render does not report a leads change.

**Sign-off.** The operator saw a LEADS block rendered from the branch and signed it off as is on Tue 11-24 (`decisions/2026-11-24-2104-p1-127-leads-block-sign-off.md`). The sample PNG handed over between sessions showed an older footnote than the code had, so it was re-rendered before he saw it.

**Belief corrected on contact.**

- **The seed.** The decision said to seed Tim on all 18 maintained sites. Asked again on 11-24, the operator changed it to "guess between erik and tim based on discord for projects". The seed is done after landing and is recorded on #2286 and in the workspace journal.
- **Migrations.** Production has no migration step to run: `openDb` applies pending migrations once per process. 0064 therefore lands on the first database connection after deploy. Before that, `sites` in production had no `reddoor_contact` column, which was checked with `PRAGMA table_info`.

**Cost.** The first session read $17.95 at hand-off, covering the verification, the decision, all the building and rounds 1 and 2. A per-round figure is inferred, not measured. Round 3's agent used about 150k subagent tokens.

Usage: $3.43, 628/23,162 tokens, 7,974,889/206,328 cache, rate limit allowed (this session, read mid-session before the PR; the first session's $17.95 is above)

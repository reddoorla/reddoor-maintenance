## 2026-11-03 — Spam threshold 50, two-link and forged-token trims, two narrow lure families; five review rounds

Landed (on merge): https://github.com/reddoorla/reddoor-maintenance/pull/1910. Source: reddoor-workspace `reports/2026-11-03-forms-spam-review/report.md`, recommendations 2 and 3. Decisions: reddoor-workspace `decisions/2026-11-03-2036-spam-threshold-50-two-link-invariant.md` and `decisions/2026-11-03-2153-spam-1910-five-review-rounds.md`. Minors were filed as reddoorla/reddoor-maintenance#1914 and #1915.

**Why.** Three spam notifications reached clients at `links:1,keywords:1` (55), under the old threshold of 60. The highest real lead on record scored 39, so 50 catches those three and 40 is ruled out.

**"One constant" was not one constant.** Two designed protections sat exactly on 50. Links were capped at 50 so a real lead with two links (site plus portfolio) stayed deliverable, and five tests pinned that. A forged Turnstile token scored 50, so it needed a second signal. At threshold 50, both would have blocked alone. The operator chose to trim them: the second link now adds +20, so two links score 45, and a forged token scores 45. Review round 1 found the same shape in non-Latin text plus one link (25 + 25), and that pair was cut to 20 + 25 under the same rule.

**The replay.** All 755 stored submissions were replayed through `main` and the branch. The instrument check came first: `main` reproduces the stored `spam_score` on 590 of 664 scored rows. The other 74 were scored before later list additions, and every one of them scores higher today. Threshold 50 newly flags 21 rows. Each was read by eye: all are spam, none is a real lead. Four of them had reached a client: `sub_9e42e57f…` and `sub_6a413d34…` (reddoor), `sub_b490916a…` (espada) and `sub_bd5d15b2…` (msot). The trim keeps one row delivered, `sub_f24a2320…`, a charity sponsorship request with two links. No row stops being flagged. Across five rounds of changes, the set of 21 stayed identical.

**The families catch nothing on the record, and the report's "about 9" does not hold.** All 9 lure and broker notifications that reached clients score 0 on everything else: no link, no seller keyword, no blocked domain. The classifier has no free-mail signal. A corroborating +30 therefore leaves every one of them at 30, delivered. The final phrases hit 4 stored rows. The families bite only when a future copy carries a second signal, and ERP, where most of the 9 landed, gains nothing from this PR.

**Five review rounds, each finding another way a real lead writes a family phrase.** The first phrase list had 17 entries. Each round of Opus real-lead review found a genuine message that matched one and, with a link, scored 55:

- round 1: an RFQ to MSOT or Revogen ("interested in procuring", "interest in purchasing your products");
- round 2: a distributor's "proposed unit price", a collector asking a gallery "are you interested in selling", and a broker with "buyers actively looking" for land;
- round 3: an owner who has "considered selling the business";
- round 4: substring matching, so "never considered" matched "ever considered", plus a subcontractor thanking a client for "the invitation to bid", and a homeowner's "invite your team to submit a quote";
- round 5: reported speech, "my accountant asked if I'd ever considered selling the business".

Six phrases remain, all template wording in the second person or referring to an attachment, and they match on word boundaries. Round 5 was dirty, so the PR went to the operator rather than into a sixth round. He chose to land it without one.

**A test that could not fail, caught by the mutation run.** The first per-phrase test iterated `CONTENT_FAMILIES` itself, so dropping or misspelling a phrase changed the test along with the code. Mutants m11 and m12 survived until the cases were written out literally. Round 5 found the same flaw again: m28's RNA fixture never tripped gibberish, because U counts as a vowel, so dropping U from the exemption changed nothing. The sidecar now holds 31 named mutants.

**A real false positive fixed in passing.** A DNA primer quoted to Revogen ("GCTTCGGCCTTCGGTCCGTT") scored as gibberish (+35). With one link it was already blocked at 60. A pure A/C/G/T/U/N run is now exempt. The other IUPAC codes stay out, because they are all consonants and would exempt real keyboard mash.

**What was left open.** The bigger remaining risk is the existing seller keywords that a buyer could also write: "would you be open", "free shipping", "first page". With one link those now reach 55. They are listed in #1915 for the operator, because the 55 pattern is exactly what this PR set out to catch.

Usage: $20.02, 6455/203131 tokens, 44262120/1235667 cache, rate limit allowed

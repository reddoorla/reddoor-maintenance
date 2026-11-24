# 2026-11-24 — W2: the accuracy stage says who a statement is about, and stores only contradictions it can prove

Landed in reddoorla/reddoor-maintenance#2256 (`claude/w2-accuracy-own-words`). The renderer is reddoorla/reddoor-website#380. Brief: workspace `briefs/2026-11-23-audit-w2-accuracy-own-words/`. Nine sessions, each handing off at the 300k-token seam.

**Why.** The report printed the accuracy model's paraphrase. Where an answer hedged that another firm was the "most likely match", the paraphrase began "The business…", so the report gave another company's rating to the client. Each assertion now carries `subject`, `otherName` and `topic`, and a `contradicted` row names both values, each in its own quote.

**What the rounds found.** Six review rounds were run, then a fix-only round and a lens on the guard fix. Every round up to the guard fix was dirty. Most of the majors were one defect: two values that say the same thing, read as different ("6-10" against "6pm-10pm", "Texas" against "Austin", "1 year" against "12 months").

Round 3's fix added a value comparer; round 4's widened it to hours, days, places and number words (34 mutation rows, 2217 tests). Round 5 found the next false contradiction on every one of those axes, plus regressions from the widening.

At the fifth dirty round the operator chose to narrow, not patch. Now only exact kinds can be `contradicted`: a figure with the same unit, a year, a full date, or a phone number. Everything else is stored `unverified`. `e90e034f` deleted the time and place forms, 21 helpers and tables (`spanOf`, `placeOf`, `CITY_ABBREVIATIONS`, `US_STATES` among them). Reviving them means a city and initialism table, a rule for bare hours, and a review round to find what they misread.

**Round 6 found guessing that was left over:** a figure with no unit compared as a year (ZIP 78701 against 78704), a year inside "512-555-2001" or "2001 Oak Street" counted as the site's value, and a numeric date read month first. `5fcdc47a` made each `unknown`, changing 13 named assertions. The fix-only round then found that the "site also gives the engine's value" guard used the same typing, so it ignored "03/04/2001" too. Engine "March 4, 2001" against a site quote "Opened 03/04/2001, moved to the new shop April 5, 2001." was stored `contradicted` and headlined. `69aa53b7` lets either reading count in the guard only, with three pins; 2511 tests pass. One Opus lens on that change alone was clean: 21 probes, no new contradiction possible, and one accepted safe-direction loss (a true contradiction is now `unverified` when the site quote also carries the engine's date with day and month swapped).

**A defect neither repo could see alone.** The round-5 fix kept both values on a pair the code could not compare; the website reads any kept pair as a contradiction, so a withheld row with "Mon-Fri" / "Monday through Friday" headlined "your own site contradicts". Both consumer lenses found it. The values are now kept only on the client's own rows on topic `other`.

**The BR-06 departure.** The round-5 answer asked for a one-word own name to count, so that "Austin Dental is located in Austin" would confirm. That rule also confirms "Calder" plus one shared word, which is the stored defect item 8 exists to stop, and the two cases have the same shape. `80e916d0` reverted it. The business's own name is never evidence.

**Residuals, named.**
- Military hours from 1900 to 2099 ("1930") read as years.
- "Founded in 2001 by Dr. Dana Reyes" loses a true year, because "Dr" is a street word: the safe direction.
- `TOPIC_TEXT`, a verbatim copy of the website's (107 of 107 lines, `named_person` and `ownership` omitted by decision), still misses inflections (#2284).

**Beliefs corrected on contact.**
- I expected a wider comparer to catch more same values. Each widening bought the next round's majors; narrowing to exact kinds closed them.
- A hand-off said "CI passed" on the website's `8b241c2`; it was the Netlify preview. Both PRs had conflicted with their bases since about 11:40pm PT on 11-23, and a conflicted PR runs no `pull_request` workflows. No `ci` ran on four commits here until the `main` merge `fe1944f2` at 11:24am PT on 11-24. Read `mergeable_state` before trusting a green row.

**Honest accounting.**
- The old sitemap-index gap (skipped index children left `truncated: false`) was closed by W3's crawl (#2275, `fetchSidecars`), not by this PR.
- Haiku fixers wrote most of the fix commits from written briefs, and Opus lenses found every defect above.
- One fixer bypassed the pre-commit hook (`e90e034f`); lint and tsc were clean on its content.
- The rounds and fixes across both PRs cost about $207 at list price before the last session. Re-judging the 8 stored rows is still the operator's paid ask.

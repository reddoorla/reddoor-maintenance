# 2026-11-23 — Code never upgrades an accuracy verdict to `confirmed` (this PR, `claude/b02-never-upgrade-to-confirmed`)

`verifyQuotes` had one rule that moved a verdict up. When the model called a claim `contradicted` and the site used any of that claim's distinctive search terms exactly, the verdict became `confirmed`, with an 80-character window around the term as the "site quote". It was written for our own site, which lists an out-of-state mailing address on one page and its metro area on another: the model called the metro claim contradicted, and the site does say both.

**What it did to a stored report.** On one stored prospect audit, two claims the model had called contradicted were printed under "checked and fine" as matching a passage on the business's own site. One said the business is a kind of business it is not. The other said no business operates under its exact name. The terms that did the flipping were the model's evidence _against_ the claims: a phrase saying what the business actually does, and the business's own name in its footer. Finding them on the site was taken as the site agreeing. The window around the first then passed `quoteSupportsClaim`, because it happened to share two words with the claim. Sharing a term is not saying the thing.

**The rule now.** Code may only move a verdict down. `doubtingTerm` takes a `contradicted` down to `unverified` only when "your site does say this" really is a reason to doubt the model:

- the claim denies nothing (`NEGATED`: no, not, never, none, nobody, nothing, without, cannot, neither, nor, n't with either apostrophe). "No business has the name X" is refuted by the site saying X, not put in doubt;
- the term carries every name the claim asserts other than the business's own, taken from the query that produced the answer. "Based in Lakeside, Oregon" is not in doubt because the site says "Oregon", and a business's name on its own site says nothing about a claim that opens with that name;
- the claim asserts at least one such name, because a term made only of common words is a subject, not the claim;
- the model's own quote does not already contain the term, since then it saw the term and still judged the claim wrong.

The verdict then quotes the site around the term, which is now located in the un-lowercased text itself, so the window is always a real substring. The reason gives the term in the site's own spelling: `Your site does say "<term>", so we have not called this wrong.` If the window still fails the quote check, the reason falls back to "We could not find the passage…". In every other case the model's verdict and its own quote stand, under the usual quote checks. Only the model can make a verdict `confirmed`.

**Review rounds.**

- **Round 1** found two problems in the first version, which only swapped `confirmed` for `unverified`. It still printed "your site does say <the model's counter-evidence>" on exactly the two claims that started this. And the fixture reused the stored site's sentences closely enough to search for.
- **Round 2** found that the term-in-claim guard added in round 1 still fired whenever a claim opened with the business's own name, which is the common case. It also found that "Texas" was enough to doubt "Dallas, Texas", that `NEGATED` missed "cannot", "nor" and a curly apostrophe, and that the paraphrased fixture still carried the sector and state.
- The fixtures are now an invented florist mistaken for a bakery. Round 1's commit, with the stored site's sentences, was already on the public branch before round 2 found it; whether to purge it is the operator's call, recorded in the workspace.

**Tests.**

- The old test "flips contradicted to confirmed when the site uses the claim's own terms" pinned the behaviour this change removes. It now expects `unverified`, the site passage and the full reason.
- Further tests cover:
  - a lowercase, double-spaced term, quoted back in the site's own spelling;
  - a supported contradiction that must stay `contradicted` with no reason;
  - one case per guard (counter-evidence term, negated claim, the business's own name, a partial place, the term already in the model's quote);
  - twelve negation forms.
- Mutations:
  - the whole old `accuracy.ts`, 5 red;
  - `confirmed` restored in the downgrade, 2 red;
  - the negation guard removed, 11 red;
  - `NEGATED` cut to `\bno\b`, 2 red;
  - the asserted-name cover removed, 1 red;
  - the business's own name kept as asserted, 3 red;
  - the empty-names guard removed, 1 red;
  - the model-quote guard removed, 1 red;
  - the reason dropped, 2 red;
  - every `contradicted` downgraded, 1 red.

**Stored reports.** The stored rows keep only the final verdict, so a past flip cannot be read off a row directly. It leaves a signature: a `confirmed` site quote that is exactly the ±80-character window around a term's first exact occurrence in the stored crawl's site text. A read-only sweep of all 74 rows (8 carry accuracy assertions, 39 of those assertions `confirmed` with a quote) found that signature on 7 assertions in 4 rows, ours among them. Under the final rule, 1 of the 7 would come down to `unverified` and 6 would stay with the model, whose original quote the row no longer holds. Changing them changes no headline and no fix on any of the 4 reports (`toReportView` → `headlineFinding` / `allFixes`, before and after); only the "checked and fine" list changes. The per-report table is in the workspace decision file, since the rows name prospects. This PR writes nothing to Turso.

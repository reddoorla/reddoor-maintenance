# 2026-11-23 — Code never upgrades an accuracy verdict to `confirmed` (this PR, `claude/b02-never-upgrade-to-confirmed`)

`verifyQuotes` had one rule that moved a verdict up. When the model called a claim `contradicted` and the site used any of that claim's distinctive search terms exactly, the verdict became `confirmed`, with an 80-character window around the term as the "site quote". It was written for our own site, which lists an out-of-state mailing address on one page and its metro area on another: the model called the metro claim contradicted, and the site does say both.

**What it did to a stored report.** On one stored prospect audit, two claims the model had called contradicted were printed under "checked and fine" as matching a passage on the business's own site. One said the business is a kind of business it is not. The other said no business operates under its exact name. The terms that did the flipping were the model's evidence _against_ the claims: a phrase saying what the business actually does, and the business's own name in its footer. Finding them on the site was taken as the site agreeing. The window around the first then passed `quoteSupportsClaim`, because it happened to share two words with the claim. Sharing a term is not saying the thing.

**The rule now.** Code may only move a verdict down. `doubtingTerm` takes a `contradicted` down to `unverified` only when "your site does say this" really is a reason to doubt the model:

- **The claim denies nothing.** `NEGATED` covers no, not, never, none, nobody, nothing, without, cannot, neither, nor, and n't with either apostrophe. "No business has the name X" is refuted by the site saying X, not put in doubt.
- **The term carries every name the claim asserts**, apart from the business's own name. That name is taken from the branded query (`who is <name>`, `<name> reviews`) and removed only where the whole name appears as a run in the claim. Three cases this rules out:
  - "Based in Lakeside, Oregon" is not in doubt because the site says "Oregon".
  - A business's name on its own site says nothing about a claim that opens with it.
  - "Rosewood Bakery" is a different business, not "Bakery" sitting next to our "Rosewood".
- **The claim asserts at least one such name.** A term made only of common words is a subject, not the claim.
- **The model's own quote does not already contain the term.** If it did, the model saw the term and still judged the claim wrong.
- **The site uses the term as whole words.** "Salem" is not in "Jerusalem".

The term is searched for in the page text as it is, case-insensitively, so the quoted window and the reason's spelling are the site's own, and no lowercased copy shifts the offsets. In every other case the model's verdict and its own quote stand, under the usual quote checks. Only the model can make a verdict `confirmed`.

**Review rounds.**

- **Round 1** found two problems with the first version, which only swapped `confirmed` for `unverified`:
  - It still printed "your site does say <the model's counter-evidence>" on exactly the two claims that started this.
  - The fixture reused the stored site's sentences closely enough to search for.
- **Round 2** found four more:
  - The term-in-claim guard added in round 1 still fired whenever a claim opened with the business's own name, which is the common case.
  - "Texas" was enough to doubt "Dallas, Texas".
  - `NEGATED` missed "cannot", "nor" and the curly apostrophe.
  - The paraphrased fixture still carried the sector and the state.
- **Round 3** found three more:
  - The business's name was removed word by word, so "Rosewood Bakery" shrank to "Bakery".
  - Every word of the query counted as the name, including "who", "is" and "reviews".
  - `findTerm` matched inside words, and the window index came from a lowercased copy.
- The fixtures are now an invented florist mistaken for a bakery.
- Round 1's commit was already on the public branch before round 2 found its wording. Whether to purge it is the operator's call, recorded in the workspace.

**Tests.**

- The old test "flips contradicted to confirmed when the site uses the claim's own terms" pinned the behaviour this change removes. It now expects `unverified`, the site passage and the full reason.
- Further tests cover:
  - a lower-case, double-spaced term, quoted back in the site's spelling;
  - a supported contradiction that must stay `contradicted` with no reason;
  - one case per guard;
  - twelve negation forms;
  - another business sharing a word with ours;
  - a `reviews` query;
  - a name inside another word;
  - a site text that starts with characters whose lower case is longer.
- Every guard has a mutation that turns a test red:
  - the whole old `accuracy.ts`: 7 red;
  - `confirmed` restored: 3;
  - the negation guard removed: 12;
  - "nor" removed: 1;
  - the name cover removed: 3;
  - the name matched word by word: 1;
  - no `reviews` strip: 1;
  - the empty-names guard removed: 1;
  - the word boundary dropped: 1;
  - the model-quote guard removed: 1;
  - the index taken from a lowercased copy: 3;
  - the reason dropped: 3;
  - every `contradicted` downgraded: 1.

**Stored reports.** The stored rows keep only the final verdict, so a past flip cannot be read off a row directly. It leaves a signature: a `confirmed` site quote that is exactly the ±80-character window around a term's first exact occurrence in the stored crawl's site text. A read-only sweep of all 74 rows (8 carry accuracy assertions, 39 of those assertions `confirmed` with a quote) found that signature on 7 assertions in 4 rows, ours among them. Under the final rule, 1 of the 7 would come down to `unverified` and 6 would stay with the model, whose original quote the row no longer holds. Changing them changes no headline and no fix on any of the 4 reports (`toReportView` → `headlineFinding` / `allFixes`, before and after); only the "checked and fine" list changes. The per-report table is in the workspace decision file, since the rows name prospects. This PR writes nothing to Turso.

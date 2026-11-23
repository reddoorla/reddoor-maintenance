# 2026-11-23 — Code never upgrades an accuracy verdict to `confirmed` (this PR, `claude/b02-never-upgrade-to-confirmed`)

`verifyQuotes` had one rule that moved a verdict up. When the model called a claim `contradicted` and the site used any of that claim's distinctive search terms exactly, the verdict became `confirmed`, with an 80-character window around the term as the "site quote". It was written for our own site, which lists an out-of-state mailing address on one page and its metro area on another: the model called the metro claim contradicted, and the site does say both.

**What it did to a stored report.** On one stored prospect audit, two claims the model had called contradicted were printed under "checked and fine" as matching a passage on the business's own site. One said the business is a kind of business it is not. The other said no business operates under its exact name. The terms that did the flipping were the model's evidence _against_ the claims: a phrase saying what the business actually does, and the business's own name in its footer. Finding them on the site was taken as the site agreeing. The window around the first then passed `quoteSupportsClaim`, because it happened to share two words with the claim. Sharing a term is not saying the thing.

**The rule now.** Code may only move a verdict down. `doubtingTerm` takes a `contradicted` down to `unverified` only when "your site does say this" really is a reason to doubt the model:

- **The claim denies nothing.** `NEGATED` covers no, not, never, none, nobody, nothing, without, cannot, neither, nor, and n't with either apostrophe. "No business has the name X" is refuted by the site saying X, not put in doubt.
- **The term carries every name the claim asserts**, apart from the business's own name. A name here is any capitalised word, the claim's first included. A sentence-start test is fooled by "Dr." and "St.", and the first word can be the very name the claim hinges on ("Texas-based …"); here a missed name loosens the guard. The business's name is taken from the branded query (`who is <name>`, `<name> reviews`) and removed only where the whole name appears as a run in the claim. This rules out three things:
  - "Based in Lakeside, Oregon" is not in doubt because the site says "Oregon".
  - "Founded by Dr. Jane Smith" is not in doubt because the site says "Dr. Smith".
  - "Rosewood Bakery" is a different business, not "Bakery" next to our "Rosewood".
- **The claim asserts at least one such name.** A term made only of common words is a subject, not the claim.
- **The model's own quote does not already contain the term.** If it did, the model saw the term and still judged the claim wrong.
- **The site uses the term as whole words, outside the business's own name.** "Salem" is not in "Jerusalem" or "Salemtown". "Welcome to Austin Family Dental" does not say the practice is in Austin.

The term is searched for in the page text as it is, case-insensitively, so the quoted window and the reason's spelling are the site's own, and no lowercased copy shifts the offsets. In every other case the model's verdict and its own quote stand, under the usual quote checks. Only the model can make a verdict `confirmed`.

**Review rounds.**

- **Round 1** found two problems with the first version, which only swapped `confirmed` for `unverified`:
  - It still printed "your site does say <the model's counter-evidence>" on exactly the two claims that started this.
  - The fixture reused the stored site's sentences closely enough to search for.
- **Round 2** found four more:
  - The term-in-claim guard still fired on any claim opening with the business's own name.
  - "Texas" was enough to doubt "Dallas, Texas".
  - `NEGATED` missed "cannot", "nor" and the curly apostrophe.
  - The paraphrased fixture kept the sector and state.
- **Round 3** found three more:
  - The name was removed word by word.
  - Every query word counted as the name.
  - `findTerm` matched inside words, and the window index came from a lowercased copy.
- **Round 4** found two more:
  - The term was still found inside the business's own name on the page.
  - An abbreviation's period hid a name the claim asserts.
- **Round 5** found one more: the claim's first word was never counted, so "Texas-based … across Oregon" was excused by "Oregon". Fixed by counting it. That was the fifth dirty round, and the operator chose this fix and a sixth round (workspace decision, 11-23).
- The fixtures are an invented florist mistaken for a bakery.
- Round 1's commit was on the public branch before round 2 found its wording. The operator chose to accept it and squash-merge (workspace decision, 11-23).

**Tests.**

- The old test "flips contradicted to confirmed when the site uses the claim's own terms" pinned the behaviour this change removes. It now expects `unverified`, the site passage and the full reason.
- There are 75 accuracy tests, and each guard has at least one. They cover:
  - a lower-case term quoted back in the site's spelling;
  - a supported contradiction that must stay `contradicted`;
  - twelve negation forms;
  - another business sharing a word with ours;
  - a `reviews` query;
  - names inside and at the start of longer words;
  - our own name on the page;
  - two abbreviations;
  - a name that opens the claim;
  - a claim with no name;
  - a site text whose lower case is longer.
- Mutations, each measured on the final tests:

  | Mutation                          | Tests red |
  | --------------------------------- | --------- |
  | The whole old `accuracy.ts`       | 8         |
  | `confirmed` restored              | 3         |
  | Negation guard removed            | 12        |
  | "nor" removed                     | 1         |
  | Name cover removed                | 6         |
  | Name matched word by word         | 1         |
  | No `reviews` strip                | 1         |
  | Empty-names guard removed         | 1         |
  | Model-quote guard removed         | 1         |
  | Own-name mask on the page removed | 1         |
  | Abbreviation demotes a name       | 2         |
  | Claim's first word skipped        | 2         |
  | Left word boundary dropped        | 1         |
  | Right word boundary dropped       | 1         |
  | Lowercased copy                   | 4         |
  | Reason dropped                    | 4         |
  | Every `contradicted` downgraded   | 1         |

**Stored reports.** The stored rows keep only the final verdict, so a past flip cannot be read off a row directly. It leaves a signature: a `confirmed` site quote that is exactly the ±80-character window around a term's first exact occurrence in the stored crawl's site text. A read-only sweep of all 74 rows (8 carry accuracy assertions, 39 of those assertions `confirmed` with a quote) found that signature on 7 assertions in 4 rows, ours among them. Under the final rule, 1 of the 7 would come down to `unverified` and 6 would stay with the model, whose original quote the row no longer holds. Changing them changes no headline and no fix on any of the 4 reports (`toReportView` → `headlineFinding` / `allFixes`, before and after); only the "checked and fine" list changes. The per-report table is in the workspace decision file, since the rows name prospects. This PR writes nothing to Turso.

**Round 6, and the downgrade removed.** Under the operator's narrow rule, round 6 reviewed only the round-5 fix, and it was dirty. Counting the claim's first word as a name meant a sentence-initial "The" or "Our" counted too. So a claim that names nothing passed the "asserts at least one name" guard whenever the model's term began with that word. Reproduced through `checkAccuracy`: claim "The business is a bakery known for sourdough bread." with term "The business", on a site saying "Our business is not a bakery…". At `b70a2216` it stayed `contradicted`. At `cdceb093` it came down to `unverified` with `Your site does say "The business"`, excusing a false claim. That is a seventh case of the shape every round since 2 found: a guard over which words in a claim matter. At five dirty rounds the operator had pre-chosen the fallback for a dirty round 6 (workspace decision, 11-23): remove the downgrade. So "The rule now" above no longer describes the code. `doubtingTerm`, `NEGATED`, `wholeWords` and `businessNameOf` are deleted, with the two test blocks that pinned their guards. `verifyQuotes` passes the model's verdict through unchanged, and the quote checks are exactly those `main` had before this PR.

What it costs: less than the decision file expected, which was that Reddoor's own two-address case would come back as `contradicted`. It does not. "Acme Design is based in Los Angeles", called `contradicted` on a Texas mailing address, now shows as `unverified`, because the address does not say where the studio is based. The old rule existed to stop the model's `contradicted` on that case, and here the quote check already catches it. A site whose model quote does support the contradiction will now show `contradicted` where the round-1-to-5 rule might have said "your site does say". That is the model's call, and it is no longer second-guessed by a word match.

The removal had one review. It found the code clean and a major test gap. The "never upgrades" cases asserted only "not `confirmed`" and "no _your site does say_". So a mutant that put back a word-match downgrade with the quote check's own wording passed all 50 tests. Folded in: each case now pins the exact verdict and reason that `main`'s quote checks give. A new test keeps a supported contradiction `contradicted` when the site uses its search term ("metro area"). The round-6 input is a fifth case, and the Los Angeles test expects the quote check's `unverified` and its reason. 51 accuracy tests. Mutations, measured on the final tests:

| Mutation                                                                                 | Tests red |
| ---------------------------------------------------------------------------------------- | --------- |
| `main`'s `accuracy.ts` (the flip to `confirmed`)                                         | 6         |
| Round 5's `accuracy.ts` (the downgrade, `cdceb093`)                                      | 1         |
| The review's mutant: `contradicted` to `unverified` on any search term found on the site | 2         |
| Every `contradicted` set to `unverified`                                                 | 8         |
| Every `contradicted` set to `confirmed`                                                  | 3         |

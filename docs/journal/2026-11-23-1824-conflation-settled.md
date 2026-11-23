# 2026-11-23 — The name-collision verdict records whether the answer settled which business it means (#2245)

The accuracy stage's conflation verdict asked whether a branded answer "describes MORE THAN ONE business under this name, or a different business first". That definition was written around our own audit, whose answers asked "which one do you mean" across several same-named studios. It never asked whether the answer settled which one the prospect is. A stored prospect answer named the business first (city, work, site) and then set apart two unrelated things that share its initials, a biomarker and a credential. It was recorded as `detected: true`, and the website led that report on "the assistant is not sure which you are", calling both things businesses.

`conflation.settled` now carries that judgment, and `otherNames` describes each thing in the answer's own words. The renderer change is reddoorla/reddoor-website#375. A stray "Avoid generic words" line that had drifted below the conflation paragraph went back under `searchTerms`.

**Proving the prompt before writing anything.** On the operator's word, the fixed prompt ran through the production `checkAccuracy` path (subscription auth, offline ownership) over the 4 stored rows that carried the flag. That dry run wrote nothing and took 73 to 93 seconds a row. The answer that was sure came back `settled: true`. The three that asked which one was meant came back `false`, each with a verbatim quote that asks. Only then was `accuracy.data.conflation` written to those 4 rows, and nothing else: every other field was checked unchanged by deep comparison, and no `opened_at` moved. The old values are kept in the workspace decision file.

**Review.** Round 1 was minors-only, so it counts as clean. One minor was folded in here: under structured output `z.toJSONSchema` lists a defaulted field as required, so the model always judges `settled`, and the default covers only unschema'd runs. The doc comment and the changeset now say so.

Usage: $7.60 at 10:24am PT (the whole session, both PRs and the re-judge), 711/69547 tokens, 19639687/327913 cache, rate limit allowed.

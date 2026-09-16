---
"@reddoorla/maintenance": patch
---

Choose a prospect audit's search terms and buyer questions by hand; generate only when blank (#676)

"Where you stand" is only as good as the five searches behind it, and those were
chosen entirely by the analyze stage from what it read on the site. For a client
we know, better ones can be written in two minutes — and for a comparison over
time the terms have to stay fixed, which a model re-reading the site each run
cannot promise.

The cockpit run form and the `prospect-audit` CLI now take optional `terms` and
`questions` (one per line). **Blank still generates, exactly as before** — this
is an override on a cold audit, never a new requirement, and that is the property
most of the new tests exist to protect.

Migrations 0025–0026 store both lists on the `prospect_audits` row rather than
only inside `result_json`, so a re-run can reuse them and the /audits listing can
show which audits used chosen terms (that listing deliberately never selects
`result_json`). NULL means generated, which is deliberately distinct from an
operator supplying an empty list.

Hand-written questions get their own version key, derived from the questions
themselves: re-running the same list compares, editing one word does not, and a
chosen set can never collide with a goal set's `${goal}-v${N}` id. That keeps
`sameQuestionSet`'s promise — two Answers scores are comparable exactly when the
same questions were asked — instead of quietly averaging two different tests. The
report says which it was: searches we chose with you, or from your site.

Note for deployment: the audit runs by `workflow_dispatch` against a private
repo, and GitHub rejects a dispatch carrying an input the workflow does not
declare. The new inputs are therefore sent ONLY when non-empty, so an audit that
chooses nothing dispatches exactly the payload it does today; the private
workflow must declare `terms` and `questions` before the new fields can be used
from the cockpit.

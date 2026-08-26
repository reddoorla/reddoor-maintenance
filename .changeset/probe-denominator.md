---
"@reddoorla/maintenance": patch
---

Divide the AI-visibility score by the probes we sent, not by the ones that came
back.

Every failure path in the probe loop was a bare `return`: a probe that errored,
or that errored again after its rate-limit retry, was dropped without a trace.
The score then divided by `categoryAnswers.length` — the survivors. So the
denominator shrank silently whenever the network did, and **a flakier run scored
higher**. Ask five buyer questions, have three fail, and have one of the two
survivors name the business, and the report read "named in 1 of 2 searches" and
scored 50. The truth was 1 of 5, which is 20. Nothing anywhere recorded that
three probes had died, and no two runs were comparable — neither between dates
for one prospect nor between prospects.

`attempted` is now the divisor, so a probe that never came back counts as "not
found". That is the conservative reading and it can understate, which is the
right direction for a number handed to a stranger — but only if they are told,
so the report now says how many searches failed and that the figure is a floor.

**A wholly dead engine is excluded rather than counted as silent refusals.** The
two ways a probe goes missing are not the same claim about the prospect: an
engine that answers nothing at all is a missing API key or a dead vendor — our
outage, no evidence either way — while an engine that answers some queries and
fails others is demonstrably alive, so those failures are real gaps in the
measurement. Attempts are tracked per engine and only live engines contribute to
the denominator. Without this split an unset environment variable would have
halved somebody's score.

**Nothing answering at all is now null, not zero.** "The engines were asked and
did not know you" and "we learned nothing" are different claims about someone
else's business, and only one of them is ours to make. That case takes the same
"not measured" path a missing stage already does.

`ProbesResult.categoryProbes` reports `{ attempted, answered }`. It is optional
because the type also describes runs deserialized from
`prospect_audits.result_json`, and reports stored before this field lack it.

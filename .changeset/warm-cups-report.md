---
"@reddoorla/maintenance": minor
---

a11y audit: contrast that was never measured is a failure, not a clean page (#888)

The first attempt at this shipped a guard built on a mechanism that does not
occur, so the mechanism is written down here in the form it was **measured**,
against axe-core 4.13.0 in Chromium.

An unparseable colour does not throw the rule. Chrome resolves
`oklch(0.205 0 none)` perfectly well, axe fails to parse it, and axe records
that **per node** as an `incomplete` entry whose check carries
`messageKey: "colorParse"`. The rule keeps running everywhere else:

| page                     | contrast passes | incomplete | messageKeys       |
| ------------------------ | --------------- | ---------- | ----------------- |
| one band with the colour | 1               | 1          | `colorParse`      |
| the colour on `body`     | 0               | 2          | `colorParse`      |
| healthy control          | 2               | 0          | none              |
| text on a gradient       | 0               | 1          | `bgGradient`      |
| no text at all           | 0               | 0          | rule inapplicable |

So the nodes behind that colour are never measured, the rest of the page
passes, and the run reports zero violations — the page looks clean because the
elements that were not legible are also the elements nobody looked at. There is
no `error-occurred` check anywhere, so a guard keyed on one could never fire.

**`colorParse` is now a `contrast-unmeasured` violation**, carrying the node
count and the remedy on one line, because that is the summary line CI prints.
It reaches the exit code, which a warn does not.

`colorParse` is the right signal precisely because it means the browser
understood the colour and axe did not: an instrument failure. The rule's other
keys — `bgImage`, `bgGradient`, `imgNode`, `elmPartiallyObscured` — are
properties of the page, where "axe cannot be sure" is the honest answer, and a
page with no text makes the rule inapplicable. None of those is reported. An
earlier cut keyed on "color-contrast missing from `passes`" and flagged the
last two as defects while missing the first.

The remedy is one line per site and provably invisible: give the token an
explicit hue. At chroma 0 the hue has no effect, and the rendered PNGs of
`oklch(0.205 0 none)` and `oklch(0.205 0 0)` are byte-identical — only axe can
tell them apart.

Coverage is now recorded as node COUNTS per rule rather than a presence flag.
The unit that matters is nodes, and a boolean is satisfied by one passing node
while sixty go unmeasured — which is the failure above.

A genuinely thrown rule is still reported as `rule-errored`, now via axe's
documented `incomplete[].error` field. It is correct; it simply was not what
#888 turned out to be.

`scripts/probe-axe-contrast.mjs` lifts the detection **verbatim** out of the
generated spec and runs it against axe in a real browser, both directions, and
exits non-zero if any case reports the wrong way. Unit tests on a hand-built
artifact are what let the wrong mechanism ship; this is the check that would
have caught it.

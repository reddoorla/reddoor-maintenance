---
"@reddoorla/maintenance": patch
---

launch: the dev-guard source scan understands regex literals, so a quote inside one no longer blocks a correctly guarded launch (#726)

`matchingDisposition` decides whether a site's `/dev/match` twin carries a real
dev guard by scanning source text through two passes: `stripComments` (so a
commented-out guard cannot pass) and `maskLiterals` (so a refusal word appearing
only inside a string cannot pass). Neither knew what a regex literal was.

A quote character inside one — `/[a-z0-9']+/`, most plausibly an apostrophe in a
character class — opened a string literal that never closed. `stripComments`
then under-stripped to the end of the file, and `maskLiterals` blanked that same
region and took the live `if (!dev) error(404)` with it. The predicate returned
`ok: false` on a file that **is** correctly guarded, and `launch` stopped at step
0 telling the operator "the matching twin would ship" about a site that was
fine. The shipped comment described this as two scanner bugs cancelling, which
is exactly what it was — a property neither function guaranteed.

Both scanners now recognise regex literals, sharing one lookback that resolves
the regex-vs-division ambiguity by the last significant character. A comment
stripper copies the literal through verbatim; the masker blanks its body,
keeping the delimiters and the length, on the same reasoning that masks strings
— a regex is data, so `if (!dev) RE = /throw/` must not read as a refusal. That
second half closes a false **grant** the old code had and no test covered.

The residual is named rather than papered over: `)` is not treated as opening a
regex, so `if (x) /re/.test(y)` is read as division. That case falls back to the
previous behaviour and therefore denies, which is the safe direction — a
blocked launch is visible and recoverable in a minute, a twin shipped to a
client's production site is neither.

Not done as a machine tell (#719's approach, which the issue prefers): the tell
that exists, `UNGUARDED_TWIN_TELL`, is emitted by the LIVE route at request time
and is a DENY signal — its presence proves the twin answered. A tell in source
text would be a GRANT signal self-asserted by the very file under inspection,
which a site can keep after deleting the guard. Substituting one for the other
would hand this gate the shape it exists to refuse: an assertion granting a
green.

Red first: a correctly guarded fixture whose regex literal contains an
apostrophe returned `ok: false`, and `if (!dev) RE = /throw/` returned
`ok: true`. Two controls in the same commit — a commented-out guard below a
regex literal, and `/` used as division — passed before and after, so the
fixtures can pass and the two failures were the defects, not the test.

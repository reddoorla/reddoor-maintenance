---
"@reddoorla/maintenance": patch
---

recipes/convert-to-pnpm: stop stamping a year-stale pnpm pin into every converted site, and put a test under the constant (#835)

`DEFAULT_PNPM_VERSION` read `10.33.1`. This repo's own `package.json` pins
`pnpm@11.11.0`, and so does every one of the 24 fleet repos carrying the field.
So the recipe that converts a site to pnpm wrote a version roughly a year behind
everything else into the site it had just converted, and then committed it.

Nothing caught it for a year, and the reason is worth naming: a stale pin is a
_plausible_ number. The field is well-formed, `pnpm install` succeeds, the
lockfile it produces is valid, and the conversion's own test asserted
`expect(pkg.packageManager).toMatch(/^pnpm@/)` — a shape assertion, which passes
on any version string ever published. The defect was invisible to every signal
pointed at it.

The pin is now `11.11.0`, and `DEFAULT_PNPM_VERSION` is exported so a guard can
read it. That guard, in `tests/recipes/convert-to-pnpm.test.ts`, compares it
against this package's **own** `packageManager` field — parsed with
`parsePackageManagerField`, the same reader the #834 fleet guard uses, so the
test and the guard cannot disagree about what the field says. The recipe's
conversion test now asserts the exact pin it writes rather than its shape.

Reading the repo's real field is the load-bearing part. A test comparing the
constant to a literal typed next to it can only fail when someone edits one of
the two — the same silence in a new costume. This one fails on the next `pnpm`
bump to this repo, which is the moment the drift is actually born.

Two states of the source of truth are asserted before the comparison: the field
must parse, and it must be `present`. An absent or unreadable `package.json`
would otherwise leave the guard comparing the constant against nothing and
passing — a check that cannot fail is the thing this issue is about.

Proven in both directions before landing: the guard fails on a deliberately
mismatched constant (`10.33.1`, naming both values) and passes on the corrected
one. Also corrects the now-false citation in `src/github/package-manager-pin.ts`,
which pointed at this constant in the present tense as its example of rot.

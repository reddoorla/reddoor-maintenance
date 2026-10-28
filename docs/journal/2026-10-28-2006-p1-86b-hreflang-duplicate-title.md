# 2026-10-28 — P1-86b: a translation is not a duplicate title (#1872)

Lands in the PR for branch `claude/1872-hreflang-duplicate-title`. The brief is the workspace's `briefs/2026-10-28-p1-86-handoff.md`. Review follow-ups are filed as #1874.

**Why.** P1-86 put Vida Legacy Foundation at Attention for "page titles or meta descriptions missing or duplicated". The only finding was `duplicate title "Vida Legacy Foundation": https://vidalegacy.org/ + https://vidalegacy.org/es`. Those are one page in two languages: `<html lang>` `en` and `es`, reciprocal hreflang, different descriptions, and a title that is the organisation's proper name. `summarizeBrowser` grouped titles across the whole sample and recorded no locale, so it could not tell a translation from a copy. I reproduced the finding through `browserAudit` against the live site at 11:50am PT before touching anything.

**The rule.** A same-title pair is exempt only when both of these hold:

- each route lists the other as a `<link rel="alternate" hreflang>`;
- their `<html lang>` primary subtags are both present and different.

That is the intersection of #1872's two proposals, and narrower than either. Reciprocity alone would excuse a same-language copy that someone cross-linked. Grouping by `lang` alone would excuse two unrelated pages that happen to be in two languages. Every other duplicate is reported as before. A route still counts if it duplicates any other route in its group.

**Where the locale comes from.** It is read from the served HTML, through a new pure `extractLocale`, not from a `page.evaluate` string. The chromium probe already reads `resp.text()` for the leaked-template-token check, so this costs no fetch. It is also the SSR truth search engines read, and it makes the parse unit-testable. The plain-fetch path (`defaultVerifyDeps`) parses the same way, and `reverifyRoutes` carries the locale on both of its paths:

- on a challenged route, the served HTML's locale replaces the challenge page's, and a confirmed fail drops it;
- on a route whose title was recovered from the served HTML, a missing locale is filled the same way.

Nothing new is stored: `lang` and `alternates` live on `RouteResult` and `PageFetch` only, and the audit's details carry the summary, not the routes.

**Review.** Two rounds of the 3-lens review (correctness, tests as evidence, consumers and fleet regression), all on Opus.

- **Round 1 was dirty, with two majors:**
  - The title-recovery path never filled the locale, so a flaky capture brought the exact #1872 false fail back.
  - The `fetchPage` wiring was untested: deleting `extractLocale` from it left every test green.
- **Round 1 minors, folded in with tests:**
  - `en_US` read as a different language from `en`;
  - no case-insensitivity test;
  - unquoted attributes ignored;
  - commented-out tags and `data-rel` read as real.
- **Round 2 was minors and nits only, so the review stopped.** Those are filed as #1874. The two that can over-exempt are `lang="und"` counting as a language, and an attribute name matched inside another attribute's value; both need markup on both pages.

**Defect in my own instrument, caught.** My first round-2 mutation table reported every mutant red. The cause was the vitest globalSetup: it runs `pnpm build` (a DTS type-check) whenever `src` is newer than `dist/cli/bin.js`. A type error I had just written in the backfill line, a possibly-`undefined` `lang` under `exactOptionalPropertyTypes`, failed that build, so each mutant reported "0 tests" and exit 1. That looks like red. The control run without a mutation had passed only because its build was skipped. Fixed the type error, ran the control (0 of 109 failed), and from then on touched `dist/cli/bin.js` after each patch and read the JSON reporter's counts. The real table is in the PR body. Pipes also misbehaved: `vitest … | grep` printed nothing, so the counts come from a file.

**Mutations.** All 19 turned a test red against a green control:

- the brief's three: one-way hreflang, same-`lang`, and lang always empty;
- lang read from the wrong place, three ways: the whole document, missing langs counted as different, and the verify fetch dropping the locale or resolving against a wrong base;
- every mutant the reviewers reported as surviving in round 1.

The Playwright runner's own assignment of `lang`/`alternates` has no unit seam. The evidence for it is the live run.

**Live.** At 12:03pm PT and again at 12:45pm PT, after the round-1 fixes, `browserAudit` on `https://vidalegacy.org` returned `titleMetaOk: true` with no problems over 8 routes. At 12:05pm PT the other three P1-86 sites also passed live:

- 1836dig and Data Dynamiq: the operator merged promotions reddoorla/1836dig#54 and reddoorla/data-dynamiq#89 at 11:47am PT.
- Williamson Homes: all 10 routes have descriptions. Its release no longer appears in `list_releases`, so it was published and the rebuild is out.

The cockpit still lists all four, because it reads the last nightly's stored rows. The next nightly is 7:17pm PT.

Usage: $10.13, 478/93045 tokens, 19192276/742846 cache, rate limit allowed_warning

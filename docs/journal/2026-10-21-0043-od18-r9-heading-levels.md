## 2026-10-21 — OD 18 / #674: R9, the heading outline (this PR)

R9 is the third rule in the operator's encode order: each page has exactly one level-1 heading and skips no level, with `aria-level` taken into account. It joins R2 and R4 in `src/audits/design-rules/`, as `heading-levels.ts`. The fleet a11y audit could have caught this and did not: `src/audits/a11y.ts` runs axe with WCAG tags only, which filters out axe's best-practice `page-has-heading-one` and `heading-order`.

**The outline is the one assistive technology reads.** It is read at 1440×900 and 390×844, because a phone layout can swap headings. It holds every `h1`–`h6` and `[role=heading]`, in document order, open shadow roots and their slotted light children included. Left out:

- headings hidden from assistive technology: `display: none`, `visibility: hidden`, `hidden`, or inside `aria-hidden="true"`;
- headings whose semantics are removed with `role="presentation"` or `"none"`.

A valid `aria-level` wins over the tag, and a bare `role=heading` is level 2, the ARIA default. A skip is a heading more than one level deeper than the one before it; going back up is never a skip.

**Checked against axe, which is the instrument the a11y audit already trusts.** Each fixture's verdict is compared with axe's two best-practice rules run on the same page. Where they disagree, this check is the suspect. They agree on every fixture.

**Proved on known-good pages, then on a real past page.** At 2026-10-21 00:16Z:

| Page                                                      | Result                              |
| --------------------------------------------------------- | ----------------------------------- |
| reddoorla.com/about                                       | **PASS**, 12 headings at each width |
| vidalegacy.org                                            | **PASS**, 10                        |
| www.beachfrontdentistry.com                               | **PASS**, 14                        |
| reddoor-website built at `947683a`, `/about` (before #65) | **FAIL**, 3 findings                |

The past `/about` fails exactly as #65 found by eye:

- it has no level-1 heading;
- "We will listen", an `h5`, comes after the `h2` "Our Promises", skipping levels 3 and 4;
- "The Reddoor Story", an `h6`, comes after the `h2` "Serving our clients, near and far."

The fixtures copy that page's outline heading for heading, before and after #65 (c380b83).

**Corrected on contact.** The first version walked a shadow host's shadow root _instead of_ its light children, so a heading slotted into a web component was never read. No fixture had a shadow root, so nothing showed it. The walk now reads both, as R4's does, and a card component with an `h2` in its shadow root and a slotted `h4` fails as a skip.

**Not covered.**

- Part (b) of R9: a heading whose level changed should keep its visual size. That needs two builds to compare.
- Empty headings, which are R15's.

**Mutations.** Each turns at least one test red:

| Mutation                                   | Red tests |
| ------------------------------------------ | --------- |
| a skip of one level accepted (the brief's) | 2         |
| `aria-level` ignored                       | 1         |
| `display: none` headings read              | 2         |
| `aria-hidden` headings read                | 1         |
| `role=presentation` headings read          | 1         |
| `role=heading` not read                    | 1         |
| an extra level-1 heading allowed           | 1         |
| no level-1 heading allowed                 | 1         |
| slotted light children not read            | 1         |

The suite is 11 tests in `heading-levels.test.ts`, in a real Chromium against a local server, plus the pure summarizer.

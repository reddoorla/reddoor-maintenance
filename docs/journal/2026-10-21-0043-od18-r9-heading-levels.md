## 2026-10-21 — OD 18 / #674: R9, the heading outline (this PR)

R9 is the third rule in the operator's encode order: each page has exactly one level-1 heading and skips no level, with `aria-level` taken into account. It joins R2 and R4 in `src/audits/design-rules/`, as `heading-levels.ts`. The fleet a11y audit could have caught this and did not: `src/audits/a11y.ts` runs axe with WCAG tags only, which filters out axe's best-practice `page-has-heading-one` and `heading-order`.

**The outline is the one assistive technology reads.** It is read at 1440×900 and 390×844, because a phone layout can swap headings. The check first scrolls the page with `revealBelowFold`, so a slice that mounts on scroll is in it.

It holds every `h1`–`h6` and `[role=heading]` in reading order:

- an open shadow root is read in place of its host's children;
- a slotted element is read where its `<slot>` sits;
- a light child that no slot takes is not rendered, and is not read.

It leaves out what is not in the accessibility tree:

- not rendered: `display: none`, a closed `<details>`, or `content-visibility: hidden`;
- `visibility: hidden`;
- `inert`;
- inside `aria-hidden="true"`, walking up the flat tree, so a slot's own ancestors count.

A heading tag with any role but `heading` (presentation, none, tab) is not a heading. A `display: contents` heading has no box of its own but stays in the tree, so its nearest flat-tree ancestor with a box answers for whether it renders.

The level is `aria-level` when it reads as 1 or more, else the tag's level; a bare `role=heading` is level 2, the ARIA default. `aria-level` is read as axe reads it, by its leading whole number, so "4x" is 4. I tried a stricter reading in round 1, and axe disagreed on the fixture, so the check follows the instrument it is checked against.

A skip is a heading more than one level deeper than the one before it; going back up is never a skip.

**Checked against axe, which is the instrument the a11y audit already trusts.** Four fixtures compare this check's verdict with axe's two best-practice rules on the same page:

- reddoor-website `/about` before #65;
- the same page after #65;
- the not-in-the-outline page;
- a single-level skip.

They agree on all four. Where they disagree, this check is the suspect.

**Proved on known-good pages, then on a real past page.** The same at 00:16Z and, after round 2, at 01:27Z:

| Page                                                      | Result                              |
| --------------------------------------------------------- | ----------------------------------- |
| reddoorla.com/about                                       | **PASS**, 12 headings at each width |
| vidalegacy.org                                            | **PASS**, 10                        |
| beachfrontdentistry.com                                   | **PASS**, 14                        |
| reddoor-website built at `947683a`, `/about` (before #65) | **FAIL**, 3 findings                |

The past `/about` fails exactly as #65 found by eye:

- it has no level-1 heading;
- "We will listen", an `h5`, comes after the `h2` "Our Promises", skipping levels 3 and 4;
- "The Reddoor Story", an `h6`, comes after the `h2` "Serving our clients, near and far."

The fixtures copy that page's outline heading for heading, before and after #65 (c380b83).

**Corrected on contact, before review.** The first version walked a shadow host's shadow root and never its light children, so a slotted heading was never read. No fixture had a shadow root. I fixed it by reading both, which round 1 then showed was wrong in its own way.

**Review round 1 was dirty**:

- **Reading order.** Reading both sides put every shadow child ahead of every light child. A named slot ahead of the shadow root's own `h3` read the `h3` first, and failed a page that does not skip. The walk now follows slots.
- **False fails:**
  - headings in a closed `<details>`, a `content-visibility: hidden` section, or an `inert` drawer were counted;
  - a heading tag with `role="tab"` was counted.
- **Unheld:** `visibility: hidden`, the `hidden` attribute, `role="none"` and the role default had no fixture. Each now has one.

**Review round 2 was dirty**:

- **A false fail and a false pass, from one cause.** The `aria-hidden` and `inert` walk climbed a slotted heading's light parents and never its slot's, so a heading slotted inside `<div aria-hidden="true">` or `<div inert>` was counted.
- **A false fail.** A heading with `display: contents` (Tailwind's `contents`) was dropped, because `checkVisibility()` is false for an element with no box. The page then read as having no `h1`.
- **A false pass.** A slice mounted by an IntersectionObserver below the fold was never read. R2 and R4 scroll first for exactly this.
- **Folded in.** The tsx keep-names guard now covers R9's in-page sampler too.

**Review round 3 was dirty**, in round 2's own fix:

- **A false fail.** The `display: contents` branch asked the heading's parent whether it renders. When that parent had no box either (a `contents` wrapper, or the `<slot>` a component slots it through, which is `display: contents` by default), the visible heading was dropped. A page whose `h1` sat that way read as having none. The check now walks up the flat tree to the first ancestor with a box.

**Not covered.**

- Part (b) of R9: a heading whose level changed should keep its visual size. That needs two builds to compare.
- Empty headings, which are R15's.
- Headings inside iframes and closed shadow roots.
- The page behind a modal `<dialog>`, which assistive technology treats as inert but which carries no `inert` attribute.

**Mutations.** Each turns at least one test red:

| Mutation                                            | Red tests |
| --------------------------------------------------- | --------- |
| a skip of one level accepted (the brief's)          | 3         |
| rendering not checked                               | 2         |
| visibility not checked                              | 1         |
| a `display: contents` heading judged by its own box | 1         |
| `display: contents` walked one level only           | 1         |
| `inert` not read                                    | 2         |
| `aria-hidden` not read                              | 2         |
| a slot's ancestors not walked                       | 1         |
| a tag with another role read as a heading           | 1         |
| `role=heading` not read                             | 1         |
| `aria-level` ignored                                | 1         |
| slots not followed                                  | 2         |
| no scroll before reading                            | 1         |
| an extra level-1 heading allowed                    | 1         |
| no level-1 heading allowed                          | 1         |

The suite is 14 tests in `heading-levels.test.ts`, in a real Chromium against a local server, plus the pure summarizer.

---
"@reddoorla/maintenance": minor
---

a11y audit: contrast that was never measured is a failure, not a clean page (#888)

Tailwind 4.3 defines 13 palette entries with a `none` hue: every `neutral-*`,
`zinc-50` and `mauve-50`, e.g. `oklch(20.5% 0 none)` for `neutral-900`. Chrome
renders them. axe-core 4.13.0, the latest release, cannot parse them. The audit
fails only on `violations`, so when axe could not measure a colour the page
read as clean. What happens depends on where the colour sits under the text.
Both cases were measured in Chromium, and `scripts/probe-axe-contrast.mjs`
re-runs them:

| where the colour sits                                                                      | what axe does                                                                                                                            | reported as           |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| first opaque background behind the text                                                    | leaves that node `incomplete` with `messageKey: "colorParse"`; the rule runs on elsewhere                                                | `contrast-unmeasured` |
| beneath an opaque background: a white CTA or card in the band (the starter's `Hero` slice) | **throws**; `color-contrast` is skipped for the **whole page**, as one `incomplete` entry carrying `error` and an `error-occurred` check | `rule-errored`        |

The second case is the one #888 reported, with 0 contrast nodes on a page
that measures 61 once the colour is removed. axe's message was:
`Unable to parse color "oklch(0.205 0 none)" Skipping color-contrast rule.`
The correction later posted on the issue was right about the first case, but
it called the second impossible, because its probes only put the colour
directly behind the text. With a white
CTA inside the band, as in the starter's `Hero`, the rule throws.

**Both are now violations, and so they reach the exit code:**

- `contrast-unmeasured` (serious). The summary line gives the node count, the
  colour axe rejected, and the fix:
  `2 element(s) on a colour axe cannot parse (oklch(0.205 0 none)), so contrast was never measured there — give the oklch() token an explicit hue (identical at chroma 0)`.
- `rule-errored` (serious), for any rule that has axe's documented
  `incomplete[].error` field. The line gives axe's own message, and adds the
  same fix when that message is a colour-parse failure.

**The fix, one line per site, changes nothing on screen:** give the token an
explicit hue. At chroma 0 the hue has no effect, and `oklch(0.205 0 none)` and
`oklch(0.205 0 0)` render byte-identical PNGs. Only axe can tell them apart.
The live test shows what that uncovers: with the hue given, axe measures a
band it had skipped, and the band fails at 1.57:1 (axe's own measurement).

**Not reported.** The rule's other `incomplete` reasons are properties of the
page: `bgImage`, `bgGradient`, `imgNode`, `elmPartiallyObscured`,
`shortTextContent`. For those, "axe cannot be sure" is the honest answer. A
page with no text makes the rule inapplicable. An earlier cut keyed on
"`color-contrast` missing from `passes`". It flagged both of those healthy
pages and missed the first case.

**How this sits with the reveal pass (#100 / #950):**

- Detection reads axe's results after the page has been scrolled and settled.
  A reveal on such a colour is measured revealed and reported. Before, it
  dropped out of the rule at `opacity: 0`.
- Both findings go through the same cross-origin frame split as axe's own
  violations. An unparseable colour, or a thrown rule, inside a third party's
  frame is counted in `frameNodesDropped` and named in the summary. It is
  never failed.

**Coverage is recorded** as `measured: [{ route, ruleNodes }]` in the
artifact: how many nodes each rule passed on each route. It is a count, not a
presence flag, because one passing node would satisfy a flag while sixty went
unmeasured. It is recorded only; nothing gates on it.

**New ways a site can turn red on this bump.** A site goes red when an audited
route has text on or over a `none`-hued token. That includes the starter's
`/dev/a11y-fixtures`, which renders the `Hero` slice (`bg-neutral-900` with a
white CTA) wherever a site still carries it. These sites were never clean:
contrast on those pages had not been measured.

`tests/audits/a11y-live-spec.test.ts` runs every shape above through the real
audit in Chromium. The same file also holds a gradient that must not be
reported, a reveal that must be, the explicit-hue control, and the
third-party frame.

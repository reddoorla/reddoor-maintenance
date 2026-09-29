---
"@reddoorla/maintenance": minor
---

a11y audit: contrast that axe never measured is now a failure, not a clean page (#888)

The a11y gate fails only on axe's `violations`. Where axe could not measure a
colour, a page therefore read as clean. The common cause is Tailwind 4.3's
palette. It writes 13 entries with a `none` hue: every `neutral-*`, plus
`zinc-50` and `mauve-50`. For example, `neutral-900` is `oklch(20.5% 0 none)`.
Browsers render `none` as 0. axe-core 4.13.0, the latest release, cannot parse
it.

**What now fails.** Each shape below was measured in Chromium.
`scripts/probe-axe-contrast.mjs` re-runs the first five rows.

| On an audited route                                                                                    | What axe does                                                               | Reported as           |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- | --------------------- |
| Text on such a colour (the first opaque background behind it)                                          | leaves that node unmeasured (`colorParse`) and checks the rest              | `contrast-unmeasured` |
| Text **coloured** with one (`text-neutral-*`)                                                          | the same                                                                    | `contrast-unmeasured` |
| Such a colour **beneath** an opaque background: a white CTA or card in the band (the starter's `Hero`) | the color-contrast rule **throws**, and that whole document goes unmeasured | `rule-errored`        |
| A `text-shadow` in such a colour                                                                       | color-contrast throws                                                       | `rule-errored`        |
| A link inside a text block, coloured or bordered with one                                              | link-in-text-block throws                                                   | `rule-errored`        |
| Any other axe rule that throws                                                                         | that rule measures nothing in that document                                 | `rule-errored`        |

Both findings are serious, so each fails the gate on its own. These pages
were never clean, because contrast on them was never measured. The Hero shape
is #888 as it was reported: 0 contrast nodes on a page that measures 61 once
the colour is gone.

**The fix, stated in each finding.** For a colour with `none`, the summary line
says to write 0 there, and it names the colour's own function, e.g.
`write 0 for "none" in the oklch() token`. Because browsers already render
`none` as 0, nothing on screen changes. The screenshots are byte-identical at
all 11 of the palette's lightness values. For the starter's palette this is a
13-token `@theme` override, staged in reddoor-starter. With it, the starter's
own gate goes from `rule-errored on a11y fixtures` (0 contrast nodes measured)
to 0 violations (64 measured). The Blux-track template, reddoor-starter-blux,
has the same Hero and goes red the same way. The same override takes it to
0 violations (66 measured), and that fix is to follow.

**A crash is attributed to the frame it happened in.** axe runs each frame
separately:

- A crash inside a third party's cross-origin frame is counted in
  `frameNodesDropped` and named in the summary, never failed. This follows
  0.101.0's rule for third-party frames.
- A crash in the site's own document, in a same-origin frame, or with no node
  to attribute fails as `rule-errored`, naming the rule and axe's message. Two
  rules that threw on one route are listed separately.

To make that possible, the audit now reads axe's **raw** report. When a rule
threw in any frame, axe's default report keeps only that rule's `incomplete`
group. So a color-contrast crash inside an embed used to erase the site's own
contrast violations and passes. The raw report keeps every group of every
rule, and places each crash in its own frame. For a rule that did not throw,
the report reads exactly as before, and 0.101.0's live tests pass unchanged.

**Not reported:** color-contrast's other `incomplete` reasons (`bgImage`,
`bgGradient`, `imgNode`, `elmPartiallyObscured`, `shortTextContent`, and the
rest of axe's list). Those are properties of the page, where "axe cannot be
sure" is the honest answer.

**Not caught:** a colour with `none` in its **alpha** slot (`/ none`). axe
parses it and treats it as opaque, so text on it or in it is measured wrongly
and passes. For example, white text on an `oklch(0.2 0 0 / none)` band reads
18.09:1, though the band renders transparent and the text white on white.
Nothing in axe's output tells that case apart from a real pass. Tailwind
4.3.3's CSS never writes a `none` alpha.

**Recorded, not gated:** `measured: [{ route, ruleNodes }]` in the artifact.
It counts, per rule, the nodes axe passed on each route.

`tests/audits/a11y-live-spec.test.ts` runs the table's first three rows and its
last one through the real audit. The probe covers the `text-shadow` and link
rows. The live test also runs:

- each finding alone failing the gate;
- a crash inside a third-party frame that leaves the site's own failure
  standing;
- the site's crash beside a third party's;
- a crash in a same-origin frame;
- a reveal on such a colour.

---
"@reddoorla/maintenance": minor
---

feat(blux): faithful-grid emit — extract three things the Blux export already
encodes but the pipeline was dropping, so every future site inherits them
instead of needing per-site hand-edits.

- **Media intrinsic sizing.** `Media`/`RenderMedia` gain `width`/`aspect`/`fit`,
  read off a foreground image holder's inline pixel `width` (the width the export
  actually renders it at — rule, logo, or full photo), its `.mediaRatio`
  `data-og-ratio` (aspect), and `background-size` (contain/cover, case-insensitive).
  The render layer treats `width` as advisory and caps it at 100% of the cell, so
  a graphic keeps its true size and a photo still fills. Non-px widths and band
  backgrounds carry no sizing.
- **Hard line breaks + entity decoding.** Title text now flows through a shared
  `blockPlainText` (headings and subtitles alike): a display title's `<br>`
  survives into the page doc as a newline (was collapsed to a space) while
  insignificant source-formatting whitespace folds to spaces (robust to
  non-minified exports), and HTML entities decode (`Bar &amp; Grill` →
  `Bar & Grill`) consistently across both paths.
- **CTA links.** A leaf `<a>` (an in-band button/text link with no structural
  descendants) is captured as a `raw` node instead of being peeled away and
  dropped; an anchor that wraps media still peels so the inner image resolves.
  A band whose only surplus content is such a link falls to the render-faithful
  `Grid` fallback rather than silently dropping the link during promotion.

Site-level design tuning (content padding, hidden-on-live elements, column
widths) is deliberately NOT extracted — it is not encoded in the export and
stays a per-site concern.

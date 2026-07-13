---
"reddoor-maintenance": minor
---

feat(blux): faithful-grid emit — extract three things the Blux export already
encodes but the pipeline was dropping, so every future site inherits them
instead of needing per-site hand-edits.

- **Media intrinsic sizing.** `Media`/`RenderMedia` gain `width`/`aspect`/`fit`,
  read off a foreground image holder's inline pixel `width`, its `.mediaRatio`
  `data-og-ratio` (aspect), and `background-size` (contain/cover). The render
  layer sizes small rules/logos to their true width instead of stretching them
  full-bleed. Non-px widths and band backgrounds carry no sizing.
- **Hard line breaks.** A display title's `<br>` now survives into the page doc
  as a newline (was collapsed to a space) via a shared `blockPlainText`, which
  keeps only real `<br>` breaks and folds insignificant source-formatting
  whitespace to spaces (robust to non-minified exports).
- **CTA links.** A leaf `<a>` (a button/text link with no structural
  descendants) is captured as a `raw` node instead of being peeled away and
  dropped; an anchor that wraps media still peels so the inner image resolves.
  A band whose only surplus content is such a link falls to the render-faithful
  `Grid` fallback rather than silently dropping the link during promotion.

Site-level design tuning (content padding, hidden-on-live elements, column
widths) is deliberately NOT extracted — it is not encoded in the export and
stays a per-site concern.

---
"@reddoorla/maintenance": patch
---

prospect: read the copy out of `<script type="application/json">` before scoring JS dependence (#828)

`extractPage` dropped every `<script>` body, so text shipped inside a structured
JSON payload was measured as "only appears after JavaScript runs" — and that is
the normal shape of a stock Next.js (`__NEXT_DATA__`) or Nuxt (`__NUXT_DATA__`)
page. Such a site lost up to 60 of readability's 100 points for copy an
assistant demonstrably reads, and every prospect report already sent for one
understates it. The "fix" we handed that prospect was work they did not need to
do.

The correction is in extraction, not in the weight: #675 confirmed the 60-point
weight is right for the case it was built for. `extractPage` now projects a
`dataText` field — the bodies of `application/json`, `application/ld+json` and
`…+json` scripts, capped and kept out of the visible `text` — and `jsDependence`
counts a rendered word as missing only when it appears nowhere in the served
HTML, payload included.

Executable inline scripts are deliberately still excluded. #675's JS-FETCHED arm
is why: its loader's own source contains the literal words of the sentence it
writes at runtime, so reading code as text would credit a page for copy no
assistant can see.

Measured on the committed #675 fixtures, both directions, before → after:

| arm                                      | avgMissing  | readability |
| ---------------------------------------- | ----------- | ----------- |
| script-embedded (assistant reads it 3/3) | 5.3% → 0.0% | 82 → 85     |
| runtime-JS (NOT STATED 3/3)              | 5.4% → 5.4% | 82 → 82     |
| stock Next.js, whole copy in the payload | 100% → 0.0% | 13 → 73     |

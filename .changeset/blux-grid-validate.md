---
"@reddoorla/maintenance": minor
---

blux grid plan 6: offline layout-signature validation gate. New pure
`validateLayout` diffs the classified `SliceSpec[]` (the source answer key,
already gated band→spec by the classify golden) against the emitted
`blux-presentation.json` manifest and names every band whose layout drifted,
media dropped, or map went missing — no browser, fully deterministic. Grid
bands must round-trip their structural signature (`sigOf`, token-canonical so a
source node and its `raw`-less render twin compare equal); smart slices are
payload-checked, and a SplitFeature's text subtree is signature-checked too so
a dropped nested media isn't reported faithful. `blux convert` now appends a
fidelity summary and writes `layout-report.json` (still exits 0 — a generator
never gates); `blux validate <dir>` runs the gate offline and exits non-zero on
findings, with `--against <file|url>` layering the existing content-coverage
check as informational text. The convert pipeline is extracted into a shared
`convertExport` so convert and validate agree on which media resolve. A
grid-validate golden pins the-pointe converting with zero findings.

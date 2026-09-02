---
"@reddoorla/maintenance": patch
---

Capture `block-subbody` text in the Blux grid parser, which was silently dropped

The grid parser recognized `block-title`, `block-body` and `block-subtitle`, but
not `block-subbody`. A `block-subbody` element therefore parsed as an
unrecognized `raw` node and its text never reached the emitted content, with no
error — the failure mode was a paragraph quietly missing from the migrated page.

`block-subbody` appears on 4+ sites in the export set (mediaStudios, thePinnacle,
theTower, strategyAdvantage). Where it carries a unique body paragraph rather
than link text — williamsonHomes' about-page lead, for instance — that paragraph
was lost.

It is now treated as a body leaf, the same text role as `block-body`.

This fix was originally written in July (#451) and merged into
`feat/blux-catalog-emit`, but did not survive that branch's squash to main in
#452, so it never actually shipped.

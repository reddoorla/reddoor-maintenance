---
"@reddoorla/maintenance": minor
---

Confirmation emails get rich text and real per-form-type defaults.

**Rich text.** The reply body is now a block/span AST rather than flat strings —
bold, italic, links, bulleted and numbered lists, and two heading levels — and
`@reddoorla/maintenance/forms/prismic` maps a Prismic Rich Text field straight
onto it. Deliberately an AST and NOT an HTML string: the envelope crosses an
untrusted boundary twice, and a renderer that can only emit a fixed set of tags
keeps "no attacker-authored text reaches an outbound email" true by
construction. Links are restricted to `https:` and `mailto:`; anything else
renders as plain text. Spans are applied by offset BEFORE escaping, so copy
containing an `&` or `<` formats correctly.

**Per-form-type defaults.** A site that has authored nothing no longer sends
"We got your message / Thanks for reaching out to {site}" for every form. Each
form type now has its own subject and two-paragraph body — a newsletter signup
reads like a subscription confirmation, an inquiry like an inquiry. A site's
legacy per-site copy columns still win where they are set, and CMS-authored copy
still wins over everything.

BREAKING for anyone who built a `_reply` envelope by hand: `paragraphs: string[]`
is replaced by `body: ReplyBlock[]`. The only consumer is gallerysonder, updated
alongside.

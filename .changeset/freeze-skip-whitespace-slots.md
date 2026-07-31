---
"@reddoorla/maintenance": minor
---

blux freeze: whitespace-only leaves stay literal instead of becoming CMS fields

A page builder emits blank rows as content: a list item or table cell holding
`&nbsp;`, there only to occupy a line. The freeze tokenized those like any other
text leaf, which turned layout into a Prismic Rich Text field — and Rich Text
cannot store a whitespace-only value. It round-trips to `""`, the row collapses
to its padding, and the page silently loses a line of vertical rhythm.

This is a defect that only surfaces _after_ the migration, on the live site, in a
place nobody thought to re-measure. It cost the-pointe 24px of footer.

`tokenizeText` now decides "carries content" on the DECODED text rather than the
raw source. `rawText.trim()` could not see this: for a `&nbsp;` leaf it trims to
the literal string `"&nbsp;"`, which is not empty, so the leaf looked like copy.
Testing the decoded text catches every spelling — `&nbsp;`, `&#160;`, `&#xa0;`,
`&emsp;`, `&thinsp;` — because JS `String.trim()` strips the whole Unicode
whitespace class. A real character such as `&amp;` still decodes to content and
is tokenized exactly as before.

**Re-freezing an existing site shifts slot keys.** A skipped leaf does not
advance the section counter (matching how plain-whitespace leaves have always
been treated), so every key after a dropped one moves down by one within its
section. Verified against the-pointe by round-tripping its committed artifact:
94 tokenized leaves become 93, the single dropped value is `" &nbsp;"`, the
content sequence is otherwise identical, and 5 keys shift (`h.t12`–`h.t16`) in
one of its 15 sections. Since `blux freeze` and `blux migrate-frozen` regenerate
the template and the manifest together, this is self-consistent — but do not
commit a new template against an old published document.

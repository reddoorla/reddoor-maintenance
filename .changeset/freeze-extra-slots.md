---
"@reddoorla/maintenance": minor
---

blux freeze: site-declared extra slots, plus two CLI options that were missing

`blux freeze --extra-slots <path>` accepts a JSON declaration of slots the
byte-faithful template carries no token for, and appends them to the emitted
slot manifest so `blux migrate-frozen` pushes them to Prismic like any other
slot. This covers editable content the render composes itself rather than
substituting into the export's markup — a `<video>` poster (the export ships no
`poster` attribute, so there is nothing to tokenize) or a data panel the export
baked as a flattened image and the render rebuilds as real text.

Declared keys must start with the reserved `x.` prefix and are validated
against the derived keys, so a site declaration can never shadow real page
content; a malformed declaration fails the freeze rather than shipping, since
these become live CMS fields. The tool stays generic — it knows only that extra
slots exist, never what any site puts in them.

Also registers two `blux` options that the command handler already read but the
CLI never declared, so passing either was an "Unknown option" error:

- `--site <slug>` (freeze / migrate-frozen)
- `--extra-slots <path>` (freeze)

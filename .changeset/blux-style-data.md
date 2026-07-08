---
"@reddoorla/maintenance": minor
---

blux: parse the export's style data and surface it for the design pass.

- `normalizeTheme` now parses the real `styles.text` shape (`{ _label, ".textN": { css props } }`) into named `TextStyleIR` roles — font family (quotes stripped), size, weight, line height, text-transform, letter-spacing, and `__media_mobile_*` responsive overrides. Roles are named from the entry's own `.textN` key, so deleted-style `{ removed: true }` tombstones drop out instead of emitting phantom default roles and role names never renumber. Every value passes a shared CSS cleaner that rejects Blux's malformed placeholders (`""`, `"px"`, `"0.px"`) so they can't poison a Tailwind custom property.
- The theme font pair falls back to Blux's default roles (text0/text1) when `settings.fonts` names none, and `settings.fonts.google` is parsed into a font-load spec (family + numeric weights) so the design pass installs the exact `@fontsource` weights instead of measuring them off the rendered site.
- `theme.css` emits the full var set per role (`--text-textN` and `--line-height`/`--font-weight`/`--font-family`/`--text-transform`/`--letter-spacing`/`--mobile-font-size`/`--mobile-line-height`), labeled with the role's export name, led by a `/* Fonts to load — … */` comment.
- Sections gain `presentation` hints: the text roles a block's `_title`/`_body` class references, per-element inline overrides on those elements (e.g. a hero title's white `color`), and the block's own layout styles. These ride the migration plan as `stylesManifest` (emitted as `styles-manifest.json`, indexes aligned with each document's post-filter slice zone) and are never pushed to Prismic — the consuming site's design pass works from data instead of screenshots.

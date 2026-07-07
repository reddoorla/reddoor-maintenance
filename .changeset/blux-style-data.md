---
"reddoor-maintenance": minor
---

blux: parse the export's style data and surface it for the design pass.

- `normalizeTheme` now parses the real `styles.text` shape (`{ _label, ".textN": { css props } }`) into named `TextStyleIR` roles — font family (quotes stripped), size, weight, line height, text-transform, letter-spacing — and falls back to Blux's default roles (text0/text1) for the theme font pair when `settings.fonts` names none.
- `theme.css` emits the full var set per role (`--text-textN`, `--line-height`, `--font-weight`, `--font-family`, `--text-transform`, `--letter-spacing`), labeled with the role's export name.
- Sections gain `presentation` hints: the text role a block's `_title`/`_body` class references plus its string-valued block styles. These ride the migration plan as `stylesManifest` (emitted as `styles-manifest.json`, indexes aligned with each document's post-filter slice zone) and are never pushed to Prismic — the consuming site's design pass works from data instead of screenshots.

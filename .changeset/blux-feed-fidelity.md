---
"@reddoorla/maintenance": patch
---

blux convert: feed-tile fidelity fixes from a full adversarial review of the
materialization. Five real gaps vs the live site (one review finding — a
"code-point" title sort — was refuted by the export's own sort JS, which uses
localeCompare, so that stayed):

- Tag filter now matches singular/plural (a trailing "s"): a `projects` filter
  also selects `project`-tagged media, recovering 7 real gallery tiles an
  exact match dropped (interior 100 → 107, matching live exactly).
- `__media` grids now apply the configured sort (the gallery/portfolio grids
  are `fdate` — newest-first — not media-upload order).
- `__media` tiles now carry their overlay captions: the library entry's `name`
  is the tile title and `description` the body (both real display text, not a
  filename as previously assumed) — escaped as plain text.
- Feed-record title/body are placed as HTML VERBATIM (Blux stores them as HTML
  with entities pre-encoded): a `<br>` renders as a break, and `&amp;` is no
  longer double-escaped to a visible `&amp;`.

Proven on composition: gallery 132 → 139 images with captions, zero double-
escapes, zero template-token leaks, all reconstructed urls resolve.

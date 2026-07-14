---
"reddoor-maintenance": patch
---

fix(blux): emit fidelity pass — backgrounds, video, title roles, fonts, map

Seven additive faithfulness fixes found by auditing the emit output against the
real the-pointe export, none touching the core media-leaf/wrapper-peel path:

- **Band backgrounds** now carry `background-size` (`auto`/`contain`) + non-center
  `background-position`, so a corner-anchored native-size accent (`bg-lines-*.png`
  on bands 1/7/9) isn't stretched full-bleed like a `cover` photo.
- **Foreground video** captures its intrinsic aspect (the `%`-suffixed
  `data-og-ratio`/`.mediaRatio`, which previously NaN'd) and its `<video>`
  playback attributes (`controls`/`playsinline`/…), so a user-controlled inline
  video isn't rendered as a background loop.
- **Hero/TitleBand** carry the heading's `textN` role + level and the subtitle's
  role (band 15's script-accent title no longer renders like a plain title). The
  text itself stays the Prismic page-doc string.
- **Typekit fonts**: a `T:` `font-ident` decodes to the real family (`ysxc` →
  Montserrat) instead of the obfuscated id, and its weight (n6 → 600) is folded
  into the font-load hint that `settings.fonts.google` omits.
- **Map**: the mount's inline `height` (600px) and the chip→content-panel binding
  (`panelIndex` + `defaultToggle`) are extracted.

Render-side consumption of these fields (the-pointe) is a separate front-half PR.
Golden + unit tests updated; the convert-golden stub resolver now mirrors the
real passthrough so position/playback are exercised end-to-end.

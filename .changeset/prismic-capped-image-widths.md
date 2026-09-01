---
"@reddoorla/maintenance": minor
---

Add `@reddoorla/maintenance/images` with `cappedWidths()` for Prismic srcsets.

`<PrismicImage>` advertises every default width (up to `3840w`) regardless of
how big the source asset actually is, so browsers on wide or retina screens ask
Prismic to upscale on demand. Those variants are always a cache MISS, are
expensive to generate, and are the ones that surface as slow or failed images in
production while the same asset's smaller variants serve fine. A fleet audit
found this in 14 of 15 Prismic sites — 158 call sites — including both starters,
so every new clone inherits it. Worst observed: a 40px source offered at `3840w`
(96x), and the 558px photo that surfaced the bug on revogen (6.9x).

`cappedWidths(field)` trims the candidate list to the image's own pixel width.
Upscaling adds no detail, so the rendered result is identical while the
expensive transforms disappear. Sources already at or above the widest candidate
keep the default list untouched, so no image is ever offered a _wider_ candidate
than before.

```svelte
<PrismicImage
  field={slice.primary.image}
  widths={cappedWidths(slice.primary.image)}
  sizes="(min-width: 768px) 50vw, 100vw"
/>
```

The entry is dependency-free — the image field is accepted structurally rather
than as `@prismicio/client`'s `ImageField`, so consuming sites pull in no new
dependency. Note that `widths` is the mechanical half of the fix: `sizes` still
needs a per-slot value, since only the site knows its layout.

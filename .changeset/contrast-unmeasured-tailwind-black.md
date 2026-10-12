---
"@reddoorla/maintenance": patch
---

The a11y audit's `contrast-unmeasured` remedy names the likely source, Tailwind's `black/<alpha>` for a colour of the shape `oklab(0 none none / α)`, which is lightningcss's fold of `color-mix(in oklab, #000 N%, transparent)` and appears in no source file. It now says to define black as `oklab(0 0 0)`, which renders identically, instead of "write 0 for none in the oklab() token".

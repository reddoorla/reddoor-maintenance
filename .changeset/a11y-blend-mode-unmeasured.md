---
"@reddoorla/maintenance": patch
---

The a11y gate no longer fails a page because axe-core cannot compute its blend mode. axe-core 4.13 has no `plus-lighter` blend function, so text over a `mix-blend-mode: plus-lighter` layer (Tailwind's `mix-blend-plus-lighter`) makes its `color-contrast` rule throw `blendFunctions[blendMode] is not a function`, which skips the rule for the whole page. Since 0.102.0 that failed as `rule-errored`; vida-legacy-foundation's grain overlays hit it on `/` and `/es`.

That one error is now "not measured": the spec re-runs the rule with each element it crashed on excluded, so the rest of the page's contrast is still measured, and each excluded element is recorded in the artifact (`blendUnmeasured`) and counted on the summary line with the rule, the blend mode and the route. It moves a clean run to `warn`, never to `fail`. Every other crash still fails as `rule-errored`, as does a blend crash that keeps recurring after 25 re-runs of the rule on one route.

---
"@reddoorla/maintenance": patch
---

The a11y gate no longer fails a page because axe-core cannot compute its blend mode. axe-core 4.13 has no `plus-lighter` blend function, so text over a `mix-blend-mode: plus-lighter` layer (Tailwind's `mix-blend-plus-lighter`) makes its `color-contrast` rule, and `link-in-text-block` beside it, throw `blendFunctions[blendMode] is not a function`, which skips the rule for the whole page. The `rule-errored` check that ships in the same release would have failed that page; vida-legacy-foundation's grain overlays hit it on `/` and `/es`.

That one error is now "not measured" when axe files it on an element of the page's own top-level document. The spec re-runs the rule with that element excluded and its child elements included again, until the rule stops crashing, so only that element's own text goes unmeasured and the rest of the page's contrast is still measured. Each excluded element is recorded in the artifact (`blendUnmeasured`) and counted on the summary line with the rule, the blend mode and the route. It moves a clean run to `warn`, never to `fail`.

Every other crash still fails as `rule-errored`, as does a blend crash still recurring after 25 re-runs of one rule on one route. A blend crash inside a frame is not re-run around: one in a third party's frame is counted and does not fail, as before, and one in the site's own frame fails.

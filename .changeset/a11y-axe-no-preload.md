---
"@reddoorla/maintenance": patch
---

a11y audit: axe runs with `preload: false`, so a site's CSP no longer logs a `connect-src` violation on every audit (reddoorla/roalson-interests#52)

axe's CSSOM preload re-fetches every stylesheet it cannot read in place, which
means every cross-origin sheet loaded without `crossorigin`, and it does so
with an XHR. The page's CSP judges that XHR under `connect-src`, not
`style-src`. roalson-interests allows fonts.googleapis.com for styles only, so
every axe run posted a real report to `/api/csp-report` and logged
`Couldn't load preload assets`. The preload was then dropped and the rules ran
without it anyway.

The cause is confirmed in real Chromium on a page with roalson's CSP shape. With
the default preload the page gets one `connect-src` report whose blocked URI is
the cross-origin sheet. With `preload: false` it gets none. The page's own
`<link>` loads the sheet in both cases.

The gate cannot lose a violation it could have raised. In axe-core 4.13 only two
rules read preloaded assets. `css-orientation-lock` is tagged `experimental`, so
the gate's WCAG tags never run it. `no-autoplay-audio` is `reviewOnFail`, so it
can only report `incomplete`. A new test reads axe-core's own rule table
against the tags the generated spec ships, and it fails if a future axe-core
adds a preload rule the gate would run.

`AxeBuilder.options()` replaces the whole options object, and `withTags()`
writes the tag filter into that object. So `.options()` has to come first.
Called after `withTags()`, it drops the WCAG tag filter without any error and
axe runs every rule it has. The live test plants a violation that only a
`best-practice` rule reports, so the wrong order fails it.

No site's CSP changes.

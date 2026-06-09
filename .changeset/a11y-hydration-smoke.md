---
"@reddoorla/maintenance": minor
---

feat(a11y audit): hydration smoke-check on `/`

The a11y audit now smoke-loads the homepage (`smokeRoutes`, default `/`) and fails
on any uncaught client-side exception — catching the class of bug where build + SSR
succeed but client hydration throws and blanks the page (e.g. a Svelte 4→5 `run()`
referencing a `$state` declared after it → TDZ ReferenceError on hydrate, which axe
over `/dev` fixtures never sees). No axe runs on smoke routes (real routes carry
a11y debt we don't gate on), and HTTP/SSR errors don't fire `pageerror`, so a
data-less CI homepage that renders empty-but-valid won't false-fail. Runs inside the
existing `reddoor-maint audit --only a11y` step — no CI workflow change; propagates
to the fleet on the next Renovate bump of `@reddoorla/maintenance`.

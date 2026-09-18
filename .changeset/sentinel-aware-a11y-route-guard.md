---
"@reddoorla/maintenance": minor
---

The a11y audit's route-status guard is sentinel-aware: a 404 on a site's own route while it still carries the starter's `your-prismic-repo-name` is the designed answer, not a missing route (#863).

The guard added in #680 is right that a configured route returning non-200 is a config problem — before it, a 404 was scanned as if it existed and reported green for months. What it did not know is that a clone between `/new-site` step 3c (point the gates at real routes) and step 6 (wire the Prismic repository) has no repository behind its content routes at all, so `getByUID("page","home")` cannot resolve and `/` 404s by design. Every new site passes through that window, and in it the first maintenance-bump PR failed on `route-missing on / (/ returned 404)` — a red with no defect behind it, which either sends someone debugging a non-bug or teaches them to route around the gate.

`readsPlaceholderPrismicRepo` (`src/audits/util/site-config.ts`) reads `slicemachine.config.json` — and `prismic.config.json`, the name the Prismic CLI migration renames it to — beside the `package.json` the audit already reads, and marks the site's own `reddoor.a11yRoutes` as tolerating a 404 while the sentinel is there. The decision itself is one exported pure function, `classifyRouteResponse`, serialized into the generated Playwright spec rather than transcribed into it, so the branch the tests exercise is the branch that runs.

Bounded deliberately, in three directions:

- **The `/dev/*` fixtures are never tolerated**, on any site. They are served by the dev server the axe scan runs against, where the #717 `/dev` layout guard is inert, so they owe a 200 whatever the Prismic config says — and reddoor-starter, which sits on the sentinel permanently, is the repo those fixtures are defined in. A rule that tolerated any 404 on a placeholder site would stop checking them exactly there.
- **Only 404**, never a 500 or a dead navigation. "No content yet" is a 404; a placeholder site whose dev server throws is still broken.
- **Only `your-prismic-repo-name`**, not `PLACEHOLDER_REPOSITORY_NAMES` from `src/prismic/models/config.ts`. That list also holds `reddoor-wireframer` — which is on it precisely because it RESOLVES, with published documents, and data-dynamiq really renders from it. That list means "mint no token"; this one means "a 404 here is expected", and merging them would buy a live production site silent tolerance of a dead homepage. The committed config is read, never `VITE_PRISMIC_ENVIRONMENT`, for the same reason `tests/smoke/routes.ts` throws when that variable names the sentinel under CI.

A skip is never silent. The summary count becomes `N of M routes` the moment anything is skipped, and the note names the route and the reason: `a11y: 0 violations across 2 of 3 routes (2 fixtures + 1 from package.json; 1 skipped: / — placeholder Prismic repo) (+1 hydration smoke)`. A run that skipped nothing keeps its line byte-for-byte. The artifact JSON gains a `skipped` array beside `violations`.

This gives a site the honest third answer — "this route is not scannable yet, and here is why" — so `/new-site` step 3c can keep asking for real routes at bootstrap. The template's workaround (`a11yRoutes: []`, reddoorla/reddoor-starter#148) traded a false red for a false green, and an empty list is exactly the configuration that let a critical `image-alt` violation ship to five production pages with CI green.

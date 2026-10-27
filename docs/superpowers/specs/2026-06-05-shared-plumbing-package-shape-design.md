# Design — Shared-PLUMBING-package shape (M7 gating sub-decision)

> **Status:** decided 2026-06-05. Resolves the open sub-decision that gates roadmap **M7.3 / M7.4**
> (`docs/superpowers/specs/2026-06-02-fleet-scale-roadmap.md`): _"keep everything in
> `@reddoorla/maintenance` vs split a sibling for the Svelte-importable bits."_
> **Decision: single package (Approach A).** No split, no monorepo.

## Context

M7 (decided 2026-06-04) adopts the **shared-PLUMBING-package model**: the starter stays the clone
skeleton; `@reddoorla/maintenance` becomes the shared "brain" that every site — including the
starter — depends on; Renovate + `self-updating` propagate every fix (fix-once-apply-all). Design
components stay per-site **forever** — the shared UI/design-component library is **PARKED** and, per
the 2026-06-05 brainstorm, will stay parked: every site owns its own design setup.

The roadmap left one question open: the package shape. The stated worry was that the
Svelte-importable plumbing has _"a Svelte peer-dep surface the CLI doesn't,"_ implying a possible
need to split a sibling package with a different build + release cadence.

## The finding that settles it

Investigation of the actual plumbing surface (starter `reddoor-starter`) shows the Svelte surface is
**two dev-only fixture pages**, not a component library:

| Plumbing piece                                                    | Source type                                  | Build path                              |
| ----------------------------------------------------------------- | -------------------------------------------- | --------------------------------------- |
| eslint / svelte / prettier / lighthouse / playwright-a11y configs | `.ts` factories                              | tsup (already shipped today)            |
| csp-report endpoint                                               | `+server.ts` → exportable `POST` handler     | tsup                                    |
| Prismic client / preview                                          | `prismicio.ts`                               | tsup                                    |
| analytics wiring                                                  | `.ts`                                        | tsup                                    |
| **a11y-fixtures + animate-in**                                    | **2× `.svelte`** (dev-only test scaffolding) | shipped raw, compiled by consuming site |

Two facts collapse the split's rationale:

1. **The Svelte surface is two raw fixture files**, not a forcing function. tsup never compiles them;
   they ship raw and the consuming site's own vite/svelte plugin compiles them. There is no
   build-tool conflict to escape by splitting.
2. **Fleet sites already depend on `@reddoorla/maintenance`** for the config factories, so they
   already install its full dependency tree. The "lighter install" argument for a sibling UI
   package is therefore moot — the deps are already present.

A split (sibling package or monorepo) only pays off if the UI/design library un-PARKs (a real,
growing Svelte component surface). That has been explicitly ruled out. Splitting now would **double**
the per-fix upkeep (two publishes, two Renovate targets, two version bumps, a home for shared types)
for a two-file surface — directly against M7's north star of _minimal total personal work_ and the
PARKED-UI-library lesson (_don't extract shared code until it earns its keep_).

## Decision — Approach A: single package, new exports

`@reddoorla/maintenance` gains a small set of new export paths alongside today's `./configs/*`. No
new package, no workspace, no second build tool.

### TS plumbing → tsup, exactly like the existing configs

Add each new TS plumbing entry to the **existing** mechanism — `tsup.config.ts` `entry[]` plus an
`exports` map entry. These compile and type-emit identically to the config factories already shipped:

```
@reddoorla/maintenance/server/csp-report   → src/plumbing/csp-report.ts   (exports POST handler)
@reddoorla/maintenance/prismic             → src/plumbing/prismic.ts       (client/preview factory)
@reddoorla/maintenance/analytics           → src/plumbing/analytics.ts
```

Exact export-map shape (mirrors current `./configs/*` entries):

```jsonc
"./server/csp-report": {
  "types": "./dist/plumbing/csp-report.d.ts",
  "import": "./dist/plumbing/csp-report.js"
}
```

> Note — these are unit-extracted handlers/factories, **not** routes. A package cannot inject routes
> into a consuming SvelteKit app's route tree. Each site keeps a **thin route shim** that re-exports
> from the package, so the file stays in the site's `src/routes` while the logic lives in the package:
>
> ```ts
> // site: src/routes/api/csp-report/+server.ts
> export { POST } from "@reddoorla/maintenance/server/csp-report";
> ```

### Svelte fixtures → shipped raw, compiled by the consumer

The two `.svelte` fixtures ship **uncompiled**. tsup's existing `onSuccess` hook already copies
non-TS assets (`check.png`, `blurredTests.jpg`) into `dist/` — extend that same hook to copy
`src/plumbing/fixtures/*.svelte` → `dist/plumbing/fixtures/`. Export them with the `svelte`
condition so the consuming site's svelte plugin resolves the raw source:

```jsonc
"./fixtures/a11y": { "svelte": "./dist/plumbing/fixtures/a11y.svelte" },
"./fixtures/animate-in": { "svelte": "./dist/plumbing/fixtures/animate-in.svelte" }
```

Consuming site's `/dev` routes become thin shims:

```svelte
<!-- site: src/routes/dev/a11y-fixtures/+page.svelte -->
<script>import A11yFixtures from "@reddoorla/maintenance/fixtures/a11y";</script>
<A11yFixtures />
```

### package.json changes

- **`svelte` as an OPTIONAL peerDep** (`peerDependenciesMeta.svelte.optional = true`): every
  consuming site already has `svelte`; CLI-only consumers (none today, but keep it honest) are not
  forced to install it.
- **`files`**: `dist` already covers the copied fixtures (they land in `dist/plumbing/fixtures/`), so
  no `files` change is needed — confirm during implementation that the `onSuccess` copy lands inside
  `dist/`.

## Units & boundaries

| Unit                             | Purpose                        | Interface                                    | Depends on                                       |
| -------------------------------- | ------------------------------ | -------------------------------------------- | ------------------------------------------------ |
| `src/plumbing/csp-report.ts`     | CSP-violation report handler   | exported `POST` (SvelteKit `RequestHandler`) | `@sveltejs/kit` types (peer)                     |
| `src/plumbing/prismic.ts`        | Prismic client/preview factory | factory fn returning configured client       | `@prismicio/client` (peer/dep — confirm at impl) |
| `src/plumbing/analytics.ts`      | analytics wiring               | exported init/helper fns                     | none beyond runtime                              |
| `src/plumbing/fixtures/*.svelte` | dev-only a11y/animate fixtures | default-export Svelte component              | `svelte` (optional peer)                         |

Each is independently importable, independently testable, and carries one purpose. The thin per-site
route shims are the well-defined interface between package logic and the site's route tree.

## Testing

- **TS plumbing:** unit tests under `tests/plumbing/` (vitest), same as existing config-factory
  tests — call the factory/handler directly, assert shape/behavior. The csp-report `POST` is tested
  by invoking it with a mock `Request`.
- **Raw-svelte shipping:** extend the existing `scripts/smoke-dist.mjs` / `test:dist` regression to
  assert `dist/plumbing/fixtures/*.svelte` exist after build and that the `svelte`-condition exports
  resolve — the package's dist-shape is already guarded there; this adds the fixture-copy invariant.
- **Conformance (M7.4):** the per-site shims are exercised by the conformance suite's existing route
  checks (`/dev/a11y-fixtures` a11y, `/api/csp-report` endpoint contract) — no new harness needed.

## Reversibility

If the UI library ever un-PARKs (the same design bug fixed twice), extracting `packages/ui` from this
single package is a mechanical move: the plumbing already lives under `src/plumbing/`, cleanly
separable. Starting single costs nothing we can't undo; starting split costs upkeep now for a payoff
that has been ruled out.

## Out of scope

- Any shared **design/presentational** components (PARKED, permanently per-site).
- The monorepo/workspace conversion (Approach C) — premature at this package count.
- The M7.0–M7.6 execution itself — this doc only fixes the package _shape_ those milestones build on.

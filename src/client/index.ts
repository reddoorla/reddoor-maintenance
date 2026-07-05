/**
 * Public `@reddoorla/maintenance/client` subpath — browser-side helpers for
 * fleet sites, bundled into a site's client build by Vite.
 *
 * Exports ONLY framework-free, dependency-free code: no svelte, no DOM lib
 * requirement at compile time, nothing from the central-only devDeps (the
 * smoke-dist gate loads this entry with those blocked to enforce it).
 */
export { whenPageReady, prefersReducedMotion } from "./page-ready.js";
export type { PageReadyOptions, PageReadyEnv, PageReadyReason } from "./page-ready.js";

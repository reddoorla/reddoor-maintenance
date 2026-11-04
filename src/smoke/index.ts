/**
 * `@reddoorla/maintenance/smoke`: checks a site's smoke specs run in the
 * browser. Imports nothing at runtime, so a site's spec can take it without
 * pulling in the rest of the package.
 */
export { measure, measureInPage, type EvaluatingPage, type OverflowMeasure } from "./measure.js";

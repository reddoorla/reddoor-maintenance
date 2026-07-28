/** Shared text normalization for the webflow extractors. */

/** Collapse runs of whitespace and trim. A value that is blank AFTER trimming
 *  collapses to `undefined` (the `|| undefined`), not `""` — every optional IR
 *  field is emitted via conditional spread under exactOptionalPropertyTypes,
 *  so "matched but empty" and "didn't match" both mean "omit the key". A ""
 *  role/subtitle/intro is never useful downstream and would otherwise
 *  propagate into Prismic docs as an empty-but-present field. */
export const clean = (s: string | undefined): string | undefined =>
  s?.replace(/\s+/g, " ").trim() || undefined;

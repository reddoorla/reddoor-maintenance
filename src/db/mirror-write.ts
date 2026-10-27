/**
 * Run one Turso write on the request path with the only error semantics the
 * store allows: a failure or a missed row throws.
 *
 * The mirror FACTORIES (`makeSiteMirror`, `makeReportMirror`, the health mirrors)
 * do this internally. The Netlify request handlers do not use those factories —
 * `approve-report`, `report-commentary`, `resend-webhook` and `site-details` each
 * call `mirrorReportPatch` / `mirrorSiteField` directly (approve-report and
 * withdraw-report call the conditioned `patchReportIfOpen`), through this. The
 * caller's own error handling decides what a throw means for the response; what
 * it must not mean is "logged and forgotten", because Turso is the only store
 * and nothing converges a write it lost.
 */
export async function mirrorWrite(
  label: string,
  /** Resolves `false` when the write's UPDATE matched no row (#647) — the
   *  writers that report a row count (`mirrorReportPatch`, `mirrorSiteFields`,
   *  …) hand it straight through; a writer that reports nothing resolves void,
   *  which counts as landed. */
  run: () => Promise<void | boolean>,
): Promise<void> {
  let matched: void | boolean;
  try {
    matched = await run();
  } catch (err) {
    throw new Error(`[${label}] Turso write failed: ${String(err)}`, { cause: err });
  }
  if (matched === false) {
    console.error(`[${label}] Turso mirror matched no row (mirrored=missed)`);
    throw new Error(`[${label}] Turso write matched no row: no such row in Turso`);
  }
}

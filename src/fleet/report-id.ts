/**
 * Report ids after Airtable (#646 step 4, operator decision 2026-09-17).
 *
 * The site decision (`site-id.ts`), applied to the other table Airtable used to
 * mint for us. Two shapes coexist PERMANENTLY:
 *
 *   - `rec…`            every report drafted before this. Airtable's record id
 *                       became the Turso primary key at import (design D1) and is
 *                       never rewritten — `reports.id` is what the approve route,
 *                       the preview url, the re-render and the send all address.
 *   - `report_<ULID>`   every report drafted since, minted here.
 *
 * The ULID encoding itself is NOT duplicated: `encodeUlid` is the one in
 * `site-id.ts`, which carries the reasoning for implementing it locally. This
 * module is the report half of the same decision, kept separate only so the two
 * prefixes cannot be confused at a call site.
 *
 * Unlike a site, a report has no slug: nothing outside the database addresses a
 * report by anything but this id, so the id IS the external handle (the preview
 * link, the approve POST, the `--rerender` argument). That is why the three
 * Netlify routes validate its shape, and why {@link isReportId} exists — the
 * routes must accept both shapes, and a shape check that only knew `rec` would
 * 404 every report drafted from now on.
 */
import { encodeUlid } from "./site-id.js";

/** Mint a new report id: `report_<ULID>`. Time-sortable, like the site ids. */
export function mintReportId(now: number = Date.now()): string {
  const random = new Uint8Array(10);
  globalThis.crypto.getRandomValues(random);
  return `report_${encodeUlid(now, random)}`;
}

/** A report id minted by {@link mintReportId}. */
export function isMintedReportId(id: string): boolean {
  return /^report_[0-9A-HJKMNP-TV-Z]{26}$/.test(id);
}

/**
 * Either shape a report id can legitimately take — the predicate the request
 * routes validate with.
 *
 * Deliberately NOT a "looks roughly like an id" test: these values come off a
 * query string, so the route answers 404 for anything that is not one of the two
 * minters' output shapes. The `rec` half is the routes' own `/^rec[A-Za-z0-9]+$/`
 * kept EXACTLY as it was — widening it here would quietly relax three request
 * paths that this change is only supposed to teach a second shape. That is also
 * why it is stricter than `isAirtableRecordId`, which is the SHADOW-WRITE
 * question ("could Airtable hold this row at all") and answers it for readable
 * test fixtures like `rec_report_1` too.
 */
export function isReportId(id: string): boolean {
  return /^rec[A-Za-z0-9]+$/.test(id) || isMintedReportId(id);
}

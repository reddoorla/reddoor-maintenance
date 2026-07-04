import type { FieldSet, Records } from "airtable";
import type { AirtableBase } from "./client.js";
import { WEBSITES_TABLE, listWebsites, siteSlug } from "./websites.js";

export type EnsureSiteInput = {
  /** Canonical slug — matches by siteSlug(Name); the Name on create when no displayName given. */
  slug: string;
  /** Human display name written to Name on create. Name is consumed VERBATIM in
   *  client-facing copy (forms auto-reply intro, report subjects), so a bare
   *  machine slug there reads as "Thanks for reaching out to acme-co." Must
   *  slugify to the same slug or the row wouldn't be found on re-run. */
  displayName?: string;
  url?: string;
  pointOfContact?: string;
  /** owner/repo. Default on create: `reddoorla/<slug>`. */
  gitRepo?: string;
};

export type EnsureSiteResult = {
  status: "created" | "exists";
  siteId: string;
  /** Airtable column names written on the exists path (create path writes all). */
  updatedFields: string[];
  /** Inputs that DIFFERED from an existing non-blank cell and were left
   *  untouched (fill-blanks-only) — surfaced so a resumed bootstrap with a
   *  corrected value doesn't silently discard it. */
  skippedMismatches: string[];
};

/** Column-name map (load-bearing magic strings — see websites.ts's mapRow header). */
const COLS = {
  url: "url",
  pointOfContact: "point of contact",
  gitRepo: "Git repo",
} as const;

/**
 * Find-or-create the Websites row for a slug so a new site exists in the fleet
 * inventory (audits, form-ingest slug resolution, reports) from day one.
 *
 * Fill-blanks-only on the exists path: this command runs from a bootstrap skill
 * that may be re-run to resume — it must never clobber operator-edited cells.
 * Frequencies are deliberately NOT set (launch flips the lifecycle); Status is
 * only written on create ("in development").
 */
export async function ensureSite(
  base: AirtableBase,
  input: EnsureSiteInput,
): Promise<EnsureSiteResult> {
  const slug = siteSlug(input.slug);
  if (!slug) throw new Error(`ensure-site: '${input.slug}' does not slugify to a usable slug`);
  if (input.displayName && siteSlug(input.displayName) !== slug)
    throw new Error(
      `ensure-site: display name '${input.displayName}' slugifies to '${siteSlug(input.displayName)}', not '${slug}' — the row would not be found on re-run`,
    );

  const existing = (await listWebsites(base)).find((w) => siteSlug(w.name) === slug);

  if (!existing) {
    const fields: FieldSet = {
      Name: input.displayName ?? slug,
      Status: "in development",
      [COLS.gitRepo]: input.gitRepo ?? `reddoorla/${slug}`,
    };
    if (input.url) fields[COLS.url] = input.url;
    if (input.pointOfContact) fields[COLS.pointOfContact] = input.pointOfContact;
    const created = (await base(WEBSITES_TABLE).create([{ fields }])) as Records<FieldSet>;
    return {
      status: "created",
      siteId: created[0]!.id,
      updatedFields: [],
      skippedMismatches: [],
    };
  }

  const updates: FieldSet = {};
  const skippedMismatches: string[] = [];
  const blank = (v: unknown) => v === null || v === undefined || v === "";
  const consider = (column: string, provided: string | undefined, current: unknown) => {
    if (!provided) return;
    if (blank(current)) updates[column] = provided;
    else if (current !== provided) skippedMismatches.push(column);
  };
  consider(COLS.url, input.url, existing.url || null);
  consider(COLS.pointOfContact, input.pointOfContact, existing.pointOfContact);
  consider(COLS.gitRepo, input.gitRepo, existing.gitRepo);

  const updatedFields = Object.keys(updates);
  if (updatedFields.length > 0) {
    await base(WEBSITES_TABLE).update([{ id: existing.id, fields: updates }]);
  }
  return { status: "exists", siteId: existing.id, updatedFields, skippedMismatches };
}

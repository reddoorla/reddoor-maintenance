import type { FieldSet, Records } from "airtable";
import type { AirtableBase } from "./client.js";
import { WEBSITES_TABLE, listWebsites, siteSlug } from "./websites.js";

export type EnsureSiteInput = {
  /** Canonical slug — becomes the Airtable Name on create, matches by siteSlug(Name) otherwise. */
  slug: string;
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

  const existing = (await listWebsites(base)).find((w) => siteSlug(w.name) === slug);

  if (!existing) {
    const fields: FieldSet = {
      Name: slug,
      Status: "in development",
      [COLS.gitRepo]: input.gitRepo ?? `reddoorla/${slug}`,
    };
    if (input.url) fields[COLS.url] = input.url;
    if (input.pointOfContact) fields[COLS.pointOfContact] = input.pointOfContact;
    const created = (await base(WEBSITES_TABLE).create([{ fields }])) as Records<FieldSet>;
    return { status: "created", siteId: created[0]!.id, updatedFields: [] };
  }

  const updates: FieldSet = {};
  const blank = (v: unknown) => v === null || v === undefined || v === "";
  if (input.url && blank(existing.url || null)) updates[COLS.url] = input.url;
  if (input.pointOfContact && blank(existing.pointOfContact))
    updates[COLS.pointOfContact] = input.pointOfContact;
  if (input.gitRepo && blank(existing.gitRepo)) updates[COLS.gitRepo] = input.gitRepo;

  const updatedFields = Object.keys(updates);
  if (updatedFields.length > 0) {
    await base(WEBSITES_TABLE).update([{ id: existing.id, fields: updates }]);
  }
  return { status: "exists", siteId: existing.id, updatedFields };
}

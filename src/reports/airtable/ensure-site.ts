import type { FieldSet, Records } from "airtable";
import type { AirtableBase } from "./client.js";
import { WEBSITES_TABLE, mapRow, siteSlug, type WebsiteRow } from "./websites.js";
import { toAirtableStatus } from "./site-status.js";

export type EnsureSiteInput = {
  /** Canonical slug — matches by siteSlug(Name); the Name on create when no displayName given. */
  slug: string;
  /** Human display name written to Name on create, and — unlike every other
   *  input — UPDATED on an existing row when it differs (#664). Name is
   *  consumed VERBATIM in client-facing copy (forms auto-reply intro, report
   *  subjects), so a bare machine slug there reads as "Thanks for reaching out
   *  to acme-co." — and the row that has it is exactly the one created before
   *  the name was settled, which only this command re-run can fix. Must
   *  slugify to the same slug or the row wouldn't be found on re-run. */
  displayName?: string;
  url?: string;
  pointOfContact?: string;
  /** owner/repo. Default on create: `reddoorla/<slug>`. */
  gitRepo?: string;
};

/** #539 Phase 5. Structurally typed rather than importing the db layer's
 *  `SiteMirror`, so this module stays the leaf it has always been — a real
 *  `SiteMirror` satisfies it. Two ops because `ensureSite` has two write paths,
 *  and the create one is the reason this exists: every other site mirror is an
 *  UPDATE, which does nothing for a row that does not exist yet. */
export type EnsureSiteMirror = {
  created: (rec: { id: string; fields: Record<string, unknown> }) => Promise<void>;
  site: (siteId: string, fields: Record<string, unknown>) => Promise<void>;
  /** #645. Does Turso hold a row for this site id? Optional so every pre-#645
   *  caller (and every hand-built test mirror) is byte-for-byte unchanged —
   *  absent means the heal below never runs. */
  hasRow?: (siteId: string) => Promise<boolean>;
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
  /** #645. True when the site existed in Airtable but had NO Turso row and this
   *  run inserted one. Surfaced rather than logged-only because it is the
   *  difference between "nothing to do" and "this site's leads were being
   *  dropped until just now". */
  healedDbRow: boolean;
};

/** Column-name map (load-bearing magic strings — see websites.ts's mapRow header). */
const COLS = {
  url: "url",
  pointOfContact: "point of contact",
  gitRepo: "Git repo",
} as const;

/**
 * One select over Websites, returning the RAW stored record whose Name slugifies
 * to `slug` (#646 step 3). The Turso-native creator (`src/fleet/ensure-site.ts`)
 * uses it for the #645 heal only — to ADOPT an Airtable site that has no Turso row
 * under its own `rec` id instead of minting a second identity for it. Raw, not a
 * mapped `WebsiteRow`, because the adopt re-inserts what Airtable STORED.
 */
export async function findWebsiteRecordBySlug(
  base: AirtableBase,
  slug: string,
): Promise<{ id: string; fields: Record<string, unknown> } | null> {
  let found: { id: string; fields: Record<string, unknown> } | null = null;
  await base(WEBSITES_TABLE)
    .select({ pageSize: 100 })
    .eachPage((records, fetchNextPage) => {
      for (const rec of records) {
        if (!found && siteSlug(mapRow(rec).name) === slug)
          found = { id: rec.id, fields: rec.fields };
      }
      fetchNextPage();
    });
  return found;
}

/**
 * @deprecated since #646 step 3 — the `ensure-site` command no longer calls this.
 * New sites are created in Turso by `src/fleet/ensure-site.ts` with `site_<ULID>`
 * ids and no Airtable record. Kept, not deleted, because removing anything from
 * the Airtable layer is #646 steps 6–8, which need their own go.
 *
 * Find-or-create the Websites row for a slug so a new site exists in the fleet
 * inventory (audits, form-ingest slug resolution, reports) from day one.
 *
 * Fill-blanks-only on the exists path: this command runs from a bootstrap skill
 * that may be re-run to resume — it must never clobber operator-edited cells.
 * The one exception is `displayName` (#664): `--name` targets Name and nothing
 * else, so a differing value IS the operator's edit, and the create message
 * sends them back here to make it. Frequencies are deliberately NOT set
 * (launch flips the lifecycle); Status is only written on create ("building" —
 * Airtable's "in development" until the stage-2 vocabulary switch flips).
 */
export async function ensureSite(
  base: AirtableBase,
  input: EnsureSiteInput,
  mirror?: EnsureSiteMirror,
): Promise<EnsureSiteResult> {
  const slug = siteSlug(input.slug);
  if (!slug) throw new Error(`ensure-site: '${input.slug}' does not slugify to a usable slug`);
  if (input.displayName && siteSlug(input.displayName) !== slug)
    throw new Error(
      `ensure-site: display name '${input.displayName}' slugifies to '${siteSlug(input.displayName)}', not '${slug}' — the row would not be found on re-run`,
    );

  // Paged inline rather than through `listWebsites` so the RAW stored record
  // survives alongside the mapped row: the #645 heal below re-inserts what
  // Airtable STORED (the same contract as the create path's mirror), and a
  // mapped `WebsiteRow` cannot be turned back into a FieldSet. Same single
  // select `listWebsites` issues — no extra Airtable read.
  const raw: Array<{ id: string; fields: Record<string, unknown> }> = [];
  await base(WEBSITES_TABLE)
    .select({ pageSize: 100 })
    .eachPage((records, fetchNextPage) => {
      for (const rec of records) raw.push({ id: rec.id, fields: rec.fields });
      fetchNextPage();
    });
  let existing: WebsiteRow | undefined;
  let existingRaw: { id: string; fields: Record<string, unknown> } | undefined;
  for (const rec of raw) {
    const row = mapRow(rec);
    if (siteSlug(row.name) === slug) {
      existing = row;
      existingRaw = rec;
      break;
    }
  }

  if (!existing || !existingRaw) {
    const fields: FieldSet = {
      Name: input.displayName ?? slug,
      Status: toAirtableStatus("building"),
      [COLS.gitRepo]: input.gitRepo ?? `reddoorla/${slug}`,
    };
    if (input.url) fields[COLS.url] = input.url;
    if (input.pointOfContact) fields[COLS.pointOfContact] = input.pointOfContact;
    const created = (await base(WEBSITES_TABLE).create([{ fields }])) as Records<FieldSet>;
    const rec = created[0]!;
    // The mirror gets what Airtable STORED, never the `fields` we sent: parity
    // diffs Turso against the stored record, so mapping our own payload would
    // diverge the moment Airtable normalises a value.
    await mirror?.created({ id: rec.id, fields: rec.fields as Record<string, unknown> });
    return {
      status: "created",
      siteId: rec.id,
      updatedFields: [],
      skippedMismatches: [],
      // The create path just inserted the row; there is nothing to heal, and a
      // `hasRow` probe here would be a round-trip whose answer is already known.
      healedDbRow: false,
    };
  }

  // #645. THE gap: before this, `exists` meant "Airtable has it" and said nothing
  // about Turso. Post-flip (#643) the form-ingest lookup reads Turso ONLY, so a
  // site with an Airtable row and no Turso row has every lead answered
  // `unknown-site` — silently, permanently, and with no alarm once Phase 6 (#646)
  // deletes `mirror_missed`. `ensure-site` is the command an operator already
  // re-runs to finish a half-created site, so the heal belongs here.
  //
  // FIRST, before the fill-blanks update below: `mirror.site` is an UPDATE, and
  // under the freeze a no-match THROWS (`SITE_MIRROR … no such row in Turso`).
  // Healing second would abort ensure-site on exactly the site it exists to
  // repair. `mirrorSiteInsert` is an upsert, so a lost race just re-writes.
  let healedDbRow = false;
  if (mirror?.hasRow && !(await mirror.hasRow(existingRaw.id))) {
    await mirror.created(existingRaw);
    healedDbRow = true;
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
  // #664: Name is NOT fill-blanks. It is never blank (the slug match found it),
  // and `--name` is the only way to retitle a row created before the display
  // name was settled — the slugify guard above already proved the new value
  // resolves to the same row. Goes through the same update + mirror below, so
  // Turso gets it too.
  if (input.displayName && existing.name !== input.displayName) {
    updates["Name"] = input.displayName;
  }

  const updatedFields = Object.keys(updates);
  if (updatedFields.length > 0) {
    await base(WEBSITES_TABLE).update([{ id: existing.id, fields: updates }]);
    // The fill-blanks path writes real cells too — a resumed bootstrap that only
    // filled a blank `url` would otherwise leave Turso stale until the sync.
    await mirror?.site(existing.id, updates);
  }
  return { status: "exists", siteId: existing.id, updatedFields, skippedMismatches, healedDbRow };
}

import type { Db } from "../../db/client.js";
import type { LegacyAirtableSites } from "../../fleet/ensure-site.js";

export type EnsureSiteCommandOptions = {
  name?: string;
  url?: string;
  contact?: string;
  gitRepo?: string;
  cwd?: string;
};

/** The two stores, injectable so tests never open a real libSQL handle (even with
 *  `TURSO_*` exported) or reach Airtable. */
export type EnsureSiteCommandDeps = {
  openDb?: () => Promise<Db>;
  /** `null` = no Airtable wired (no creds): no #645 heal lookup, no `rec` shadow. */
  airtable?: () => Promise<LegacyAirtableSites | null>;
};

/** Wire the legacy Airtable half only when credentials exist. Airtable is a shadow
 *  now, so its absence is a supported state — a missing PAT must not stop a site
 *  from being created. */
async function defaultAirtable(db: Db): Promise<LegacyAirtableSites | null> {
  const { openBase, readAirtableConfig } = await import("../../reports/airtable/client.js");
  let cfg: ReturnType<typeof readAirtableConfig>;
  try {
    cfg = readAirtableConfig();
  } catch {
    return null;
  }
  const base = openBase(cfg);
  const { findWebsiteRecordBySlug } = await import("../../reports/airtable/ensure-site.js");
  const { updateSiteFields } = await import("../../reports/airtable/websites.js");
  const { mirrorSiteInsert } = await import("../../db/fleet-state.js");
  return {
    findBySlug: (slug) => findWebsiteRecordBySlug(base, slug),
    // The #645 heal: the importer's own mapping, so an adopted row is exactly what
    // the import would have written.
    adopt: (rec) => mirrorSiteInsert(db, rec, new Date().toISOString()),
    update: (recordId, patch) => {
      const fields: Record<string, string> = {};
      if (patch.name !== undefined) fields["Name"] = patch.name;
      if (patch.url !== undefined) fields["url"] = patch.url;
      if (patch.pointOfContact !== undefined) fields["point of contact"] = patch.pointOfContact;
      if (patch.gitRepo !== undefined) fields["Git repo"] = patch.gitRepo;
      return updateSiteFields(base, recordId, fields);
    },
  };
}

/**
 * `ensure-site <slug>` — create/verify a site's fleet row (#646 step 3: in Turso,
 * with a `site_<ULID>` id for a new site). Day-one step of the /new-site bootstrap
 * skill. Fill-blanks-only; safe to re-run; `--name` renames without moving the slug.
 */
export async function runEnsureSiteCommand(
  slug: string | undefined,
  opts: EnsureSiteCommandOptions,
  deps: EnsureSiteCommandDeps = {},
): Promise<{ output: string; code: number }> {
  if (!slug) return { output: "Provide a <slug> (e.g. `ensure-site roalson`).", code: 2 };
  try {
    const open =
      deps.openDb ??
      (async () => {
        const { openDb, readDbConfig } = await import("../../db/client.js");
        return openDb(readDbConfig());
      });
    const db = await open();
    const { makeSiteStore } = await import("../../db/site-create.js");
    const { ensureSite } = await import("../../fleet/ensure-site.js");
    const airtable = deps.airtable ? await deps.airtable() : await defaultAirtable(db);
    const result = await ensureSite(
      {
        slug,
        ...(opts.name ? { displayName: opts.name } : {}),
        ...(opts.url ? { url: opts.url } : {}),
        ...(opts.contact ? { pointOfContact: opts.contact } : {}),
        ...(opts.gitRepo ? { gitRepo: opts.gitRepo } : {}),
      },
      { store: makeSiteStore(db), airtable },
    );
    // #664: a name change on the exists path is a rename the operator asked for.
    const renamed = result.updatedFields.includes("name") ? ` — name set to "${opts.name}"` : "";
    const blanks = result.updatedFields.filter((f) => f !== "name");
    const filled = blanks.length > 0 ? ` — filled blank field(s): ${blanks.join(", ")}` : "";
    const skipped =
      result.skippedMismatches.length > 0
        ? ` — differs from existing, left untouched (edit on the dashboard site page): ${result.skippedMismatches.join(", ")}`
        : "";
    // #645. Loud, and its own clause: a healed row means this site's leads were
    // being answered `unknown-site` and dropped until this run.
    const healed = result.healedDbRow
      ? ` — HEALED: the Turso row was MISSING and has been adopted from Airtable; leads for this slug were being dropped (run \`db replay-deadletters\`)`
      : "";
    const nameNote =
      result.status === "created" && !opts.name
        ? ` — name set to "${slug}"; re-run with --name before forms/announce go live`
        : "";
    // The honest cost of a Turso-only site until #646 step 4 lands (see
    // src/fleet/ensure-site.ts): say it where the operator is looking.
    const batchNote =
      result.status === "created"
        ? `\n  note: no Airtable record was created (the site id is not an Airtable id). Batch jobs that still enumerate the fleet from Airtable — nightly audits incl. form-e2e, report drafting, digest — will not see this site until #646 step 4 moves them to Turso. Form ingest and the dashboard see it now.`
        : "";
    return {
      output: `[${slug}] ${result.status} (${result.siteId})${healed}${renamed}${filled}${skipped}${nameNote}${batchNote}`,
      code: 0,
    };
  } catch (err) {
    const e = err as { message?: string; exitCode?: number };
    return { output: e.message ?? String(err), code: e.exitCode ?? 1 };
  }
}

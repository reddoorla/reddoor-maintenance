import { openBase, readAirtableConfig } from "../../reports/airtable/client.js";
import { ensureSite } from "../../reports/airtable/ensure-site.js";

export type EnsureSiteCommandOptions = {
  name?: string;
  url?: string;
  contact?: string;
  gitRepo?: string;
  cwd?: string;
};

/**
 * `ensure-site <slug>` — create/verify the fleet-inventory row for a new site.
 * Day-one step of the /new-site bootstrap skill. Fill-blanks-only; safe to re-run.
 */
export async function runEnsureSiteCommand(
  slug: string | undefined,
  opts: EnsureSiteCommandOptions,
): Promise<{ output: string; code: number }> {
  if (!slug) return { output: "Provide a <slug> (e.g. `ensure-site roalson`).", code: 2 };
  try {
    const base = openBase(readAirtableConfig());
    const result = await ensureSite(base, {
      slug,
      ...(opts.name ? { displayName: opts.name } : {}),
      ...(opts.url ? { url: opts.url } : {}),
      ...(opts.contact ? { pointOfContact: opts.contact } : {}),
      ...(opts.gitRepo ? { gitRepo: opts.gitRepo } : {}),
    });
    const filled =
      result.updatedFields.length > 0
        ? ` — filled blank field(s): ${result.updatedFields.join(", ")}`
        : "";
    const skipped =
      result.skippedMismatches.length > 0
        ? ` — differs from existing, left untouched (edit in Airtable): ${result.skippedMismatches.join(", ")}`
        : "";
    const nameNote =
      result.status === "created" && !opts.name
        ? ` — Name set to "${slug}"; retitle in Airtable before forms/announce go live (or re-create with --name)`
        : "";
    return {
      output: `[${slug}] ${result.status} (${result.siteId})${filled}${skipped}${nameNote}`,
      code: 0,
    };
  } catch (err) {
    const e = err as { message?: string; exitCode?: number };
    return { output: e.message ?? String(err), code: e.exitCode ?? 1 };
  }
}

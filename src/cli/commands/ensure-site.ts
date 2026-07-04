import { openBase, readAirtableConfig } from "../../reports/airtable/client.js";
import { ensureSite } from "../../reports/airtable/ensure-site.js";

export type EnsureSiteCommandOptions = {
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
      ...(opts.url ? { url: opts.url } : {}),
      ...(opts.contact ? { pointOfContact: opts.contact } : {}),
      ...(opts.gitRepo ? { gitRepo: opts.gitRepo } : {}),
    });
    const filled =
      result.updatedFields.length > 0
        ? ` — filled blank field(s): ${result.updatedFields.join(", ")}`
        : "";
    return {
      output: `[${slug}] ${result.status} (${result.siteId})${filled}`,
      code: 0,
    };
  } catch (err) {
    const e = err as { message?: string; exitCode?: number };
    return { output: e.message ?? String(err), code: e.exitCode ?? 1 };
  }
}

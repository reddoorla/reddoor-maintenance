import type { Site, InventoryProvider } from "../types.js";
import type { AirtableBase } from "../reports/airtable/client.js";
import { listWebsites, siteSlug } from "../reports/airtable/websites.js";

export type AirtableInventoryOptions = {
  /**
   * Local workdir to compute each site's path as `{workdir}/{slug}`.
   * Defaults to REDDOOR_FLEET_WORKDIR env var if not provided.
   * Airtable doesn't store local checkout paths, so this is required.
   */
  workdir?: string;
};

/**
 * Read sites from the Airtable Websites table as an InventoryProvider.
 * Each row becomes one Site; `path` is computed as `{workdir}/{slug}`.
 * Sites where BOTH maintenance freq AND testing freq are "None" are excluded
 * (they're inactive — no scheduled audits or reports).
 *
 * Note: `repoUrl` is set to the production URL (Websites.url). For sites
 * cloned via `--workdir` semantics this is wrong — the convention should be
 * tightened (e.g. add a `repo` field to Websites) when fleet-clone-from-
 * airtable becomes a real flow. For local audits where the site is already
 * checked out at `path`, the `repoUrl` is unused.
 */
export function fromAirtableBase(
  base: AirtableBase,
  opts: AirtableInventoryOptions = {},
): InventoryProvider {
  return async (): Promise<Site[]> => {
    const workdir = opts.workdir ?? process.env.REDDOOR_FLEET_WORKDIR;
    if (!workdir) {
      throw new Error(
        "fromAirtableBase requires `workdir` option or REDDOOR_FLEET_WORKDIR env (sites need a local path)",
      );
    }
    const websites = await listWebsites(base);
    return websites
      .filter((w) => w.maintenanceFreq !== "None" || w.testingFreq !== "None")
      .map((w) => {
        const slug = siteSlug(w.name);
        const site: Site = {
          path: `${workdir}/${slug}`,
          name: slug,
          meta: { airtableRowId: w.id, displayName: w.name },
        };
        if (w.url) site.repoUrl = w.url;
        if (w.gitRepo) site.gitRepo = w.gitRepo;
        return site;
      });
  };
}

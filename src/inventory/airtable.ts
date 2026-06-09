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

/** Only sites we actively run/report on get fleet-audited. */
const AUDITABLE_STATUSES = new Set<string>(["maintenance", "launch period"]);

/**
 * Read sites from the Airtable Websites table as an InventoryProvider.
 * Each row becomes one Site; `path` is computed as `{workdir}/{slug}`.
 * Only `maintenance` / `launch period` sites that have a `url` are included
 * (the live sites we audit + report on). The production URL is exposed as
 * `Site.deployedUrl` so the lighthouse audit can run against it with no
 * checkout. `repoUrl` is intentionally NOT set from `url` — a clone source
 * must come from `gitRepo` (`owner/repo`), never the production URL.
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
      .filter((w) => AUDITABLE_STATUSES.has(w.status ?? "") && w.url.length > 0)
      .map((w) => {
        const slug = siteSlug(w.name);
        const site: Site = {
          path: `${workdir}/${slug}`,
          name: slug,
          deployedUrl: w.url,
          meta: { airtableRowId: w.id, displayName: w.name },
        };
        if (w.gitRepo) site.gitRepo = w.gitRepo;
        return site;
      });
  };
}

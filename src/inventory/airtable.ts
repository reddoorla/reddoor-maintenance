import type { Site, InventoryProvider } from "../types.js";
import type { AirtableBase } from "../reports/airtable/client.js";
import { listWebsites, siteSlug } from "../reports/airtable/websites.js";
import { isHttpUrl } from "../util/url.js";

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
      .flatMap((w) => {
        const slug = siteSlug(w.name);
        // An empty slug (a Name with no slug-able characters) can't form a stable
        // path and — fatally — can't be matched back to its Websites row on
        // write-back: every empty-slug site would collapse under the "" key and
        // mis-write or fail. Skip it loudly rather than silently mis-map it.
        if (slug.length === 0) {
          console.warn(
            `[inventory] skipping "${w.name}" (row ${w.id}): Name has no slug-able characters (empty slug)`,
          );
          return [];
        }
        const site: Site = {
          path: `${workdir}/${slug}`,
          name: slug,
          meta: { airtableRowId: w.id, displayName: w.name },
        };
        // Scheme-allowlist the Airtable `url` before exposing it as the
        // deployed-audit target (it's handed straight to Chrome/lhci). A
        // `file://`/`gopher://`/internal-host value would be a local-file read
        // or SSRF — skip the deployed audit for that site rather than trust it.
        if (isHttpUrl(w.url)) {
          site.deployedUrl = w.url;
        } else {
          console.warn(
            `[inventory] skipping deployed audit for "${w.name}": url is not http(s): ${JSON.stringify(w.url)}`,
          );
        }
        if (w.gitRepo) site.gitRepo = w.gitRepo;
        return [site];
      });
  };
}

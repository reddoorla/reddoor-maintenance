import type { Site, InventoryProvider } from "../types.js";
import type { AirtableBase } from "../reports/airtable/client.js";
import { listWebsites } from "../reports/airtable/websites.js";
import { selectFleetSites, requireFleetWorkdir } from "./select.js";

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
 *
 * No longer what `--fleet` resolves through: since #646 step 4 the fleet roster
 * is read from Turso (`fromTursoDb`, `src/inventory/turso.ts`), because a site
 * created by the Turso-native `ensure-site` has no Airtable record at all. This
 * stays as the Airtable half of the selection-parity instrument and a public
 * export until the operator approves deleting the Airtable layer (steps 6–8).
 *
 * The selection rule itself is `selectFleetSites` — shared, so the two providers
 * cannot drift. `meta.airtableRowId` is kept alongside `meta.siteId` for any
 * consumer that still reads the old key.
 */
export function fromAirtableBase(
  base: AirtableBase,
  opts: AirtableInventoryOptions = {},
): InventoryProvider {
  return async (): Promise<Site[]> => {
    const workdir = requireFleetWorkdir(opts.workdir, "fromAirtableBase");
    const websites = await listWebsites(base);
    return selectFleetSites(websites, workdir).map((s) => ({
      ...s,
      meta: { airtableRowId: s.meta?.siteId, ...s.meta },
    }));
  };
}

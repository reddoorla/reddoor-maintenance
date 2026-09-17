import type { Site, InventoryProvider } from "../types.js";
import type { Db } from "../db/client.js";
import { selectFleetSites, requireFleetWorkdir } from "./select.js";

export type TursoInventoryOptions = {
  /** Local workdir to compute each site's path as `{workdir}/{slug}`. Defaults to
   *  REDDOOR_FLEET_WORKDIR. The database holds no checkout paths, so one is required. */
  workdir?: string;
};

/**
 * The fleet roster, read from Turso (#646 step 4) — what `--fleet turso` (and its
 * deprecated alias `--fleet airtable`) resolves through.
 *
 * Why this exists: since step 3 a site created by `ensure-site` gets a
 * `site_<ULID>` id and NO Airtable record, so an Airtable-backed roster can never
 * see it. Turso holds every site, `rec…` and `site_…` alike.
 *
 * Same selection as the Airtable provider by construction (`selectFleetSites`),
 * and the same rows by proof (`tests/inventory/selection-parity.test.ts`).
 *
 * `open` is a factory rather than a handle so the provider owns the connection it
 * opened and closes it once the roster is read — a sweep holds no Turso client
 * for its whole run. The fleet-state reader is imported lazily: `kysely` and the
 * libSQL client are devDependencies, and nothing that merely imports the
 * inventory module should pull them in.
 */
export function fromTursoDb(
  open: () => Promise<Db>,
  opts: TursoInventoryOptions = {},
): InventoryProvider {
  return async (): Promise<Site[]> => {
    const workdir = requireFleetWorkdir(opts.workdir, "fromTursoDb");
    const { listSites } = await import("../db/fleet-state.js");
    const db = await open();
    try {
      return selectFleetSites(await listSites(db), workdir);
    } finally {
      await db.destroy();
    }
  };
}

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
 * deprecated alias `--fleet airtable`) resolves through. Turso holds every site,
 * `rec…` and `site_…` alike; the selection rule is `selectFleetSites`.
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

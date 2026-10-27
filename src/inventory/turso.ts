import type { Site, InventoryProvider } from "../types.js";
import type { Db } from "../db/client.js";
import type { WebsiteRow } from "../fleet/site-row.js";
import { selectFleetSites, requireFleetWorkdir, rowsWithUnrecognizedStatus } from "./select.js";

export type TursoInventoryOptions = {
  /** Local workdir to compute each site's path as `{workdir}/{slug}`. Defaults to
   *  REDDOOR_FLEET_WORKDIR. The database holds no checkout paths, so one is required. */
  workdir?: string;
  /** Called with the rows the selection dropped for a Status outside the
   *  vocabulary (`rowsWithUnrecognizedStatus`), so a sweep can report what it did
   *  not visit (#1607). */
  onUnrecognizedStatus?: (rows: WebsiteRow[]) => void;
};

/**
 * The fleet roster, read from Turso (#646 step 4) — what `--fleet turso` resolves
 * through. Turso holds every site,
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
      const rows = await listSites(db);
      opts.onUnrecognizedStatus?.(rowsWithUnrecognizedStatus(rows));
      return selectFleetSites(rows, workdir);
    } finally {
      await db.destroy();
    }
  };
}

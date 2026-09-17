import { pathToFileURL } from "node:url";
import { resolve, extname } from "node:path";
import type { InventoryProvider, Site } from "../../types.js";
import { localPath } from "../../inventory/local.js";
import { fromJsonFile } from "../../inventory/json.js";
import { isHttpUrl } from "../../util/url.js";
import type { Db } from "../../db/client.js";

/** The `--fleet` keyword that reads the fleet roster from the database (#646 step 4). */
export const FLEET_KEYWORD = "turso";

/**
 * The keyword every sweep used until #646 step 4. It is kept as an ALIAS that now
 * reads Turso, not as a path that still reads Airtable, because:
 *
 *  - Airtable can no longer answer the question. A site made by the Turso-native
 *    `ensure-site` (step 3) has a `site_<ULID>` id and no Airtable record, so an
 *    Airtable roster is silently short — the invisibility step 4 exists to close.
 *  - The keyword is typed by hand from the docs, the runbooks, AUTONOMY.md and
 *    shell history. Refusing it would break those invocations; keeping it on
 *    Airtable would keep them wrong and keep Airtable load-bearing for reads.
 *
 * It is not SILENT: every use prints DEPRECATED_FLEET_KEYWORD_WARNING to stderr,
 * naming the store actually read, so a misleading name never reads a different
 * store without saying so. Remove it with the Airtable layer (steps 6–8).
 */
export const DEPRECATED_FLEET_KEYWORD = "airtable";

export const DEPRECATED_FLEET_KEYWORD_WARNING =
  "[fleet] --fleet airtable is deprecated: the fleet roster is read from Turso, not Airtable " +
  "(#646 step 4). Use --fleet turso.";

/** A dynamic .js/.mjs/.cjs inventory returns arbitrary Site objects; apply the
 *  same `deployedUrl` scheme-allowlist the JSON + Airtable providers enforce, so
 *  a module returning `file:///…`/`gopher://…` can't reach Chrome/lhci. Drop the
 *  offending value (and warn) rather than throw — matching the JSON provider. */
export function sanitizeDynamicSites(sites: Site[]): Site[] {
  return sites.map((s) => {
    if (s.deployedUrl !== undefined && !isHttpUrl(s.deployedUrl)) {
      console.warn(
        `[inventory] dynamic inventory: ignoring deployedUrl that is not http(s) for ` +
          `${s.name ?? s.path}: ${JSON.stringify(s.deployedUrl)}`,
      );
      const copy = { ...s };
      delete copy.deployedUrl;
      return copy;
    }
    return s;
  });
}

export type ResolveSitesInput = {
  site?: string;
  fleet?: string;
  /** Optional workdir for the `--fleet turso` keyword path (computes site.path as {workdir}/{slug}). */
  workdir?: string;
  /** Test seam for the `--fleet turso` keyword: the database the roster is read
   *  from. Defaults to `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN`. */
  openDb?: () => Promise<Db>;
  cwd: string;
};

export async function resolveSites(input: ResolveSitesInput): Promise<Site[]> {
  if (input.site && input.fleet) {
    throw Object.assign(new Error("cannot combine a positional [site] with --fleet"), {
      exitCode: 2,
    });
  }

  if (input.fleet === FLEET_KEYWORD || input.fleet === DEPRECATED_FLEET_KEYWORD) {
    if (input.fleet === DEPRECATED_FLEET_KEYWORD) console.warn(DEPRECATED_FLEET_KEYWORD_WARNING);
    const { openDb, readDbConfig } = await import("../../db/client.js");
    const { fromTursoDb } = await import("../../inventory/turso.js");
    const open = input.openDb ?? (() => openDb(readDbConfig()));
    return fromTursoDb(open, input.workdir ? { workdir: input.workdir } : {})();
  }

  if (input.fleet) {
    const fleetPath = resolve(input.cwd, input.fleet);
    const ext = extname(fleetPath).toLowerCase();
    if (ext === ".json") {
      // fromJsonFile already scheme-allowlists deployedUrl internally.
      return fromJsonFile(fleetPath)();
    }
    if (ext === ".js" || ext === ".mjs" || ext === ".cjs") {
      const mod = (await import(pathToFileURL(fleetPath).href)) as {
        default?: InventoryProvider;
      };
      if (!mod.default || typeof mod.default !== "function") {
        throw Object.assign(new Error(`--fleet ${input.fleet}: default export is not a function`), {
          exitCode: 2,
        });
      }
      // A dynamic module's deployedUrl is unvalidated — sanitize before it can
      // reach a deployed audit (the JSON/Airtable providers already do this).
      return sanitizeDynamicSites(await mod.default());
    }
    throw Object.assign(
      new Error(`--fleet ${input.fleet}: unsupported extension ${ext || "(none)"}`),
      { exitCode: 2 },
    );
  }

  return localPath(resolve(input.cwd, input.site ?? input.cwd))();
}

import { pathToFileURL } from "node:url";
import { resolve, extname } from "node:path";
import type { InventoryProvider, Site } from "../../types.js";
import { localPath } from "../../inventory/local.js";
import { fromJsonFile } from "../../inventory/json.js";
import { isHttpUrl } from "../../util/url.js";
import type { Db } from "../../db/client.js";
import type { WebsiteRow } from "../../fleet/site-row.js";
import { nameFromRepo } from "./clone-if-needed.js";

/** A site with no name takes the name `cloneIfNeeded` would give it from its repo (#1650),
 *  so the gate sees one label for it at load, not a missing site and a permanent failure.
 *  A derived name is taken only when no other site already has it as an explicit `name` and
 *  no other nameless site derives the same one; otherwise the site stays nameless and keeps
 *  its path label, so two different sites never share one label at load and merge downstream.
 *  A site left nameless here is still named from its repo by `cloneIfNeeded` at prep, so that
 *  fallback can still give it the colliding name later (the #1650 drift, for that case only). */
export function nameFromRepoWhenNameless(sites: Site[]): Site[] {
  const explicit = new Set(sites.flatMap((s) => (s.name ? [s.name] : [])));
  const derived = sites.map((s) => (s.name ? undefined : nameFromRepo(s)));
  const derivedCount = new Map<string, number>();
  for (const name of derived) {
    if (name !== undefined) derivedCount.set(name, (derivedCount.get(name) ?? 0) + 1);
  }
  return sites.map((site, i) => {
    if (site.name) return site;
    const name = derived[i];
    if (name === undefined || explicit.has(name) || derivedCount.get(name) !== 1) return site;
    return { ...site, name };
  });
}

/** The `--fleet` keyword that reads the fleet roster from the database (#646 step 4). */
export const FLEET_KEYWORD = "turso";

/** A dynamic .js/.mjs/.cjs inventory returns arbitrary Site objects; apply the
 *  same `deployedUrl` scheme-allowlist the JSON + Turso providers enforce, so
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
  /** `--fleet turso` only: the rows dropped for a Status outside the vocabulary
   *  (see `rowsWithUnrecognizedStatus`). */
  onUnrecognizedStatus?: (rows: WebsiteRow[]) => void;
  cwd: string;
};

export async function resolveSites(input: ResolveSitesInput): Promise<Site[]> {
  if (input.site && input.fleet) {
    throw Object.assign(new Error("cannot combine a positional [site] with --fleet"), {
      exitCode: 2,
    });
  }

  if (input.fleet === FLEET_KEYWORD) {
    const { openDb, readDbConfig } = await import("../../db/client.js");
    const { fromTursoDb } = await import("../../inventory/turso.js");
    const open = input.openDb ?? (() => openDb(readDbConfig()));
    return fromTursoDb(open, {
      ...(input.workdir ? { workdir: input.workdir } : {}),
      ...(input.onUnrecognizedStatus ? { onUnrecognizedStatus: input.onUnrecognizedStatus } : {}),
    })();
  }

  if (input.fleet) {
    const fleetPath = resolve(input.cwd, input.fleet);
    const ext = extname(fleetPath).toLowerCase();
    if (ext === ".json") {
      // fromJsonFile already scheme-allowlists deployedUrl internally.
      return nameFromRepoWhenNameless(await fromJsonFile(fleetPath)());
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
      // reach a deployed audit (the JSON/Turso providers already do this).
      return nameFromRepoWhenNameless(sanitizeDynamicSites(await mod.default()));
    }
    throw Object.assign(
      new Error(`--fleet ${input.fleet}: unsupported extension ${ext || "(none)"}`),
      { exitCode: 2 },
    );
  }

  return localPath(resolve(input.cwd, input.site ?? input.cwd))();
}

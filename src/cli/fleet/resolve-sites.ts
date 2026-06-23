import { pathToFileURL } from "node:url";
import { resolve, extname } from "node:path";
import type { InventoryProvider, Site } from "../../types.js";
import { localPath } from "../../inventory/local.js";
import { fromJsonFile } from "../../inventory/json.js";
import { isHttpUrl } from "../../util/url.js";

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
  /** Optional workdir for the `--fleet airtable` keyword path (computes site.path as {workdir}/{slug}). */
  workdir?: string;
  cwd: string;
};

export async function resolveSites(input: ResolveSitesInput): Promise<Site[]> {
  if (input.site && input.fleet) {
    throw Object.assign(new Error("cannot combine a positional [site] with --fleet"), {
      exitCode: 2,
    });
  }

  if (input.fleet === "airtable") {
    const { openBase, readAirtableConfig } = await import("../../reports/airtable/client.js");
    const { fromAirtableBase } = await import("../../inventory/airtable.js");
    const base = openBase(readAirtableConfig());
    const provider = fromAirtableBase(base, input.workdir ? { workdir: input.workdir } : {});
    return provider();
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

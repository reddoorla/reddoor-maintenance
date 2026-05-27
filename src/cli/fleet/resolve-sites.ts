import { pathToFileURL } from "node:url";
import { resolve, extname } from "node:path";
import type { InventoryProvider, Site } from "../../types.js";
import { localPath } from "../../inventory/local.js";
import { fromJsonFile } from "../../inventory/json.js";

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
    let provider: InventoryProvider;
    if (ext === ".json") {
      provider = fromJsonFile(fleetPath);
    } else if (ext === ".js" || ext === ".mjs" || ext === ".cjs") {
      const mod = (await import(pathToFileURL(fleetPath).href)) as {
        default?: InventoryProvider;
      };
      if (!mod.default || typeof mod.default !== "function") {
        throw Object.assign(new Error(`--fleet ${input.fleet}: default export is not a function`), {
          exitCode: 2,
        });
      }
      provider = mod.default;
    } else {
      throw Object.assign(
        new Error(`--fleet ${input.fleet}: unsupported extension ${ext || "(none)"}`),
        { exitCode: 2 },
      );
    }
    return provider();
  }

  return localPath(resolve(input.cwd, input.site ?? input.cwd))();
}

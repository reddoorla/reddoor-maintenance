import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { InventoryProvider, Site } from "../types.js";

function validate(raw: unknown): Site[] {
  if (!Array.isArray(raw)) {
    throw new Error("inventory JSON must be an array of sites");
  }
  return raw.map((entry, i) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`inventory entry ${i} is not an object`);
    }
    const e = entry as Record<string, unknown>;
    if (typeof e.path !== "string" || e.path.length === 0) {
      throw new Error(`inventory entry ${i} is missing required field: path`);
    }
    if (!isAbsolute(e.path)) {
      throw new Error(
        `inventory entry ${i}: path must be absolute (got "${e.path}"). ` +
          `Relative paths are rejected so cwd at invocation can't change which site is targeted.`,
      );
    }
    const site: Site = { path: e.path };
    if (typeof e.name === "string") site.name = e.name;
    if (typeof e.repoUrl === "string") site.repoUrl = e.repoUrl;
    // Carry gitRepo/deployedUrl like the Airtable provider does, so a JSON
    // inventory can drive checkout (clone-from-gitRepo) and deployed-URL audits.
    if (typeof e.gitRepo === "string") site.gitRepo = e.gitRepo;
    if (typeof e.deployedUrl === "string") site.deployedUrl = e.deployedUrl;
    if (typeof e.meta === "object" && e.meta !== null) {
      site.meta = e.meta as Record<string, unknown>;
    }
    return site;
  });
}

export function fromJsonFile(path: string): InventoryProvider {
  return async () => {
    const raw = JSON.parse(await readFile(path, "utf-8")) as unknown;
    return validate(raw);
  };
}

import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RecipeResult, Site } from "../../types.js";
import { withRecipe } from "../_with-recipe.js";
import { HEALTH_ENDPOINT_RELATIVE, HEALTH_ENDPOINT_TEMPLATE } from "./template.js";

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Writes a resilient `src/routes/health/+server.ts` if the route doesn't already
 * exist. The function-health audit fetches this endpoint; existing sites need it
 * or the Report Health Gate blocks their Maintenance reports on "unknown". Operator
 * edits to an existing endpoint are never clobbered (noop on existing file).
 */
export async function healthEndpoint(site: Site): Promise<RecipeResult> {
  const target = join(site.path, HEALTH_ENDPOINT_RELATIVE);
  return withRecipe<{ target: string }>({
    name: "health-endpoint",
    site,
    plan: async () => {
      if (await fileExists(target)) {
        return { kind: "noop", notes: `${HEALTH_ENDPOINT_RELATIVE} already exists` };
      }
      return { kind: "apply", plan: { target } };
    },
    apply: async (planned, { commit }) => {
      await mkdir(dirname(planned.target), { recursive: true });
      await writeFile(planned.target, HEALTH_ENDPOINT_TEMPLATE, "utf-8");
      await commit("feat: add /health endpoint (function-health probe)");
      return { kind: "ok" };
    },
  });
}

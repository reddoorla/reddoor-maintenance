import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RecipeResult, Site } from "../../types.js";
import { withRecipe } from "../_with-recipe.js";
import { defaultSpawn, type SpawnFn } from "../../audits/util/spawn.js";
import { formatWithPrettier, PRETTIER_FLAG_NOTE } from "../_prettier.js";
import {
  HEALTH_ENDPOINT_RELATIVE,
  HEALTH_ENDPOINT_TEMPLATE,
  HEALTH_ENDPOINT_TEMPLATE_NO_PRISMIC,
} from "./template.js";

export type HealthEndpointDeps = { spawn: SpawnFn };

/** Where a Prismic client module lives across the fleet — `.ts` on sources,
 * `.js`/`.mjs` on some compiled clones. Existence of ANY picks the Prismic
 * variant; none => the import-free variant (a static import of a missing module
 * breaks the Vite build, which feature-detection can't rescue). */
const PRISMICIO_CANDIDATES = [
  "src/lib/prismicio.ts",
  "src/lib/prismicio.js",
  "src/lib/prismicio.mjs",
];

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function siteHasPrismic(sitePath: string): Promise<boolean> {
  for (const rel of PRISMICIO_CANDIDATES) {
    if (await fileExists(join(sitePath, rel))) return true;
  }
  return false;
}

/**
 * Writes a resilient `src/routes/health/+server.ts` if the route doesn't already
 * exist. The function-health audit fetches this endpoint; existing sites need it
 * or the Report Health Gate blocks their Maintenance reports on "unknown". Operator
 * edits to an existing endpoint are never clobbered (noop on existing file).
 *
 * Two heterogeneity fixes the fleet rollout exposed: (1) it detects whether the
 * site has a `$lib/prismicio` module and writes the Prismic-free variant when it
 * doesn't (a static import of a missing module fails the build); (2) it runs the
 * SITE's own prettier on the written file before committing, so the file matches
 * that site's formatting config (tabs/spaces, quote style vary fleet-wide) and
 * doesn't red the CI format check. Prettier is best-effort — a site without it
 * installed commits unformatted with a flag note rather than failing the recipe.
 */
export async function healthEndpoint(
  site: Site,
  deps: HealthEndpointDeps = { spawn: defaultSpawn },
): Promise<RecipeResult> {
  const target = join(site.path, HEALTH_ENDPOINT_RELATIVE);
  return withRecipe<{ target: string; template: string; hasPrismic: boolean }>({
    name: "health-endpoint",
    site,
    plan: async () => {
      if (await fileExists(target)) {
        return { kind: "noop", notes: `${HEALTH_ENDPOINT_RELATIVE} already exists` };
      }
      const hasPrismic = await siteHasPrismic(site.path);
      const template = hasPrismic ? HEALTH_ENDPOINT_TEMPLATE : HEALTH_ENDPOINT_TEMPLATE_NO_PRISMIC;
      return { kind: "apply", plan: { target, template, hasPrismic } };
    },
    apply: async (planned, { commit, cwd }) => {
      await mkdir(dirname(planned.target), { recursive: true });
      await writeFile(planned.target, planned.template, "utf-8");

      const notes: string[] = [];
      if (!planned.hasPrismic) {
        notes.push("no $lib/prismicio — wrote Prismic-free /health (prismic: skipped)");
      }

      // Format to the SITE's own prettier config so CI's format check stays green
      // across the heterogeneous fleet. Best-effort: a site without prettier just
      // commits unformatted with a flag note (never fails the /health rollout).
      if (!(await formatWithPrettier(deps.spawn, cwd, [HEALTH_ENDPOINT_RELATIVE]))) {
        notes.push(PRETTIER_FLAG_NOTE);
      }

      await commit("feat: add /health endpoint (function-health probe)");
      return notes.length > 0 ? { kind: "ok", notes: notes.join("; ") } : { kind: "ok" };
    },
  });
}

import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RecipeResult, Site } from "../../types.js";
import { withRecipe } from "../_with-recipe.js";
import { refusedByGit, undoRefusedWrites, RESTORED_NOTE } from "../_head-guard.js";
import { formatWithPrettier, resolveTargetPrettier } from "../_prettier.js";
import { defaultSpawn } from "../../audits/util/spawn.js";
import { hostnameOf, isHttpUrl } from "../../util/url.js";
import { HOOKS_CLIENT_RELATIVE, MEASUREMENT_ID_RE, hooksClientTemplate } from "./template.js";
import { planCspEdit, type CspEditPlan } from "./csp-edit.js";

const SVELTE_CONFIG_RELATIVE = "svelte.config.js";

export type AnalyticsTagOptions = {
  /** The GA4 web-stream measurement ID, `G-XXXXXXXXXX`. */
  measurementId: string;
  /** Overrides the host derived from the site's deployed URL. */
  productionHost?: string;
};

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

type Planned = {
  productionHost: string;
  hooks: string;
  csp: CspEditPlan;
  cspSource: string | null;
};

/**
 * Turn on GA4 for one site: write the client hook that starts the tag, and flip
 * the analytics hosts on in its CSP.
 *
 * Writes `src/hooks.client.ts` rather than editing `src/routes/+layout.svelte`.
 * No fleet site had that file as of 2026-09-22, so this is a create and never a
 * clobber, and the root layouts it would otherwise patch are 2.7KB to 9.7KB of
 * per-site hand-maintained markup with nothing in common to anchor an edit on.
 * An existing hook is a NOOP — someone else's file is not this recipe's to
 * rewrite.
 *
 * The CSP half refuses anything it does not recognise rather than guessing. A
 * site whose `svelte.config.js` cannot be extended safely still gets its hook
 * and is REPORTED, because the alternative is a half-rewritten policy on a live
 * site, and the browser applies that on every request.
 */
export async function analyticsTag(site: Site, opts: AnalyticsTagOptions): Promise<RecipeResult> {
  return withRecipe<Planned>({
    name: "analytics-tag",
    site,
    plan: async () => {
      const id = opts.measurementId.trim();
      if (!MEASUREMENT_ID_RE.test(id)) {
        // A malformed ID collects into nothing and looks completely healthy, so
        // it is refused before anything is written rather than audited later.
        return {
          kind: "failed",
          notes: `measurementId ${JSON.stringify(id)} is not a GA4 web-stream ID (G- plus 10 characters)`,
        };
      }

      const productionHost = opts.productionHost?.trim() || deriveHost(site);
      if (!productionHost) {
        return {
          kind: "failed",
          notes:
            "no production hostname: the site row has no http(s) URL and none was passed. " +
            "initAnalytics would keep the tag off everywhere, which is a silent no-op.",
        };
      }

      if (await fileExists(join(site.path, HOOKS_CLIENT_RELATIVE))) {
        return { kind: "noop", notes: `${HOOKS_CLIENT_RELATIVE} already exists` };
      }

      let cspSource: string | null;
      try {
        cspSource = await readFile(join(site.path, SVELTE_CONFIG_RELATIVE), "utf8");
      } catch {
        cspSource = null;
      }
      const csp: CspEditPlan = cspSource === null ? { kind: "none" } : planCspEdit(cspSource);

      return {
        kind: "apply",
        plan: {
          productionHost,
          hooks: hooksClientTemplate({ measurementId: id, productionHost }),
          csp,
          cspSource,
        },
      };
    },

    apply: async (planned, { commit, cwd }) => {
      const written: string[] = [HOOKS_CLIENT_RELATIVE];
      await writeFile(join(cwd, HOOKS_CLIENT_RELATIVE), planned.hooks, "utf8");

      if (planned.csp.kind === "edit") {
        await writeFile(join(cwd, SVELTE_CONFIG_RELATIVE), planned.csp.next, "utf8");
        written.push(SVELTE_CONFIG_RELATIVE);
      }

      // Formatting must not be able to strand the write. `withRecipe`'s failure
      // path is `git checkout -f`, which does NOT remove an untracked new file,
      // so a prettier throw used to leave src/hooks.client.ts on disk with
      // nothing in git — and the next run hit the "already exists" noop and
      // reported the site as done. Swallowing here keeps the commit reachable;
      // a formatting miss is a lint nit, and CI catches it.
      try {
        const bin = await resolveTargetPrettier(cwd);
        await formatWithPrettier(defaultSpawn, cwd, written, bin ? { bin } : {});
      } catch {
        // fall through to the commit
      }

      await commit(`feat: start GA4 on the production host (${planned.productionHost})`);

      // Did git TAKE them? A site that gitignores a path gets the file on disk,
      // nothing in the commit, and a result that reads as done — the #741 shape.
      const refusal = await refusedByGit(cwd, written, "the analytics tag");
      if (refusal) {
        await undoRefusedWrites(
          cwd,
          new Map(
            written.map((p) => [
              p,
              p === SVELTE_CONFIG_RELATIVE ? (planned.cspSource ?? null) : null,
            ]),
          ),
          refusal.missing,
        );
        return { kind: "failed", notes: refusal.notes + RESTORED_NOTE };
      }

      return { kind: "ok", notes: cspNote(planned.csp) };
    },
  });
}

function deriveHost(site: Site): string {
  const url = site.deployedUrl;
  return url && isHttpUrl(url) ? hostnameOf(url) : "";
}

/** What the operator still has to do, said plainly. An unreported CSP gap is a
 *  tag the browser refuses on every request with nothing on the page to show it. */
function cspNote(plan: CspEditPlan): string {
  switch (plan.kind) {
    case "edit":
      return "CSP: analytics hosts enabled via `csp: { analytics: true }`.";
    case "already":
      return "CSP: already had `analytics: true`.";
    case "none":
      return "CSP: this site has no `csp` option, so nothing blocks the loader.";
    case "refuse":
      return (
        `CSP NOT CHANGED — ${plan.reason}. The tag will be REFUSED by the policy until ` +
        "`analytics: true` is added to the `csp` option by hand."
      );
  }
}

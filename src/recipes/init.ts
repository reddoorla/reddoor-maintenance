import type { AuditResult, RecipeResult, Site } from "../types.js";
import { siteLabel } from "../util/site.js";
import { convertToPnpm } from "./convert-to-pnpm.js";
import { onboard } from "./onboard.js";
import { syncConfigs } from "./sync-configs.js";
import { svelteCodemods } from "./svelte-codemods.js";
import { a11yFixturesPage } from "./a11y-fixtures-page/index.js";
import { healthEndpoint } from "./health-endpoint/index.js";
import { runAudits } from "../audits/index.js";

export type InitStepResult =
  | { kind: "recipe"; result: RecipeResult }
  | { kind: "audit"; results: AuditResult[] }
  | { kind: "error"; message: string };

export type InitStep = {
  name: string;
  run: (site: Site) => Promise<InitStepResult>;
};

export type InitResult = {
  site: string;
  steps: Array<{ name: string; result: InitStepResult }>;
  /** True if every step ran; false if an `error` or `failed` recipe result
   * short-circuited the chain. `noop` recipes do not break completeness. */
  complete: boolean;
};

export type InitOptions = {
  /** Override the default step list. Tests inject mocked steps; production
   * code relies on the default. */
  steps?: InitStep[];
};

function recipeStep(name: string, fn: (site: Site) => Promise<RecipeResult>): InitStep {
  return {
    name,
    run: async (site) => ({ kind: "recipe", result: await fn(site) }),
  };
}

/** convert-to-pnpm → onboard → sync-configs → svelte-codemods →
 * a11y-fixtures-page → audit. Order is deliberate — every step depends on
 * the prior one's output (pnpm before onboard's installs, onboard's deps
 * before sync-configs writes lighthouserc, fixtures page before audit
 * actually has a route to hit). */
export const DEFAULT_INIT_STEPS: InitStep[] = [
  recipeStep("convert-to-pnpm", convertToPnpm),
  recipeStep("onboard", onboard),
  recipeStep("sync-configs", syncConfigs),
  recipeStep("svelte-codemods", svelteCodemods),
  recipeStep("a11y-fixtures-page", a11yFixturesPage),
  recipeStep("health-endpoint", healthEndpoint),
  {
    name: "audit",
    run: async (site) => ({ kind: "audit", results: await runAudits(site) }),
  },
];

/**
 * One-shot guided onboarding. Runs the default step sequence against a
 * site, collecting per-step results into an InitResult. Each underlying
 * recipe still creates its own branch — init is a thin orchestrator, not
 * a branch-collapser; the operator ends up with one stack of branches per
 * mutated step (recipes that noop don't branch).
 *
 * Stops the chain on the first uncaught error or `failed` recipe result.
 * `noop` results are expected (e.g. running init twice) and continue the
 * chain. The final audit pass runs if no prior step errored.
 */
export async function init(site: Site, opts: InitOptions = {}): Promise<InitResult> {
  const steps = opts.steps ?? DEFAULT_INIT_STEPS;
  const out: Array<{ name: string; result: InitStepResult }> = [];

  for (const step of steps) {
    let result: InitStepResult;
    try {
      result = await step.run(site);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      out.push({ name: step.name, result: { kind: "error", message } });
      return { site: siteLabel(site), steps: out, complete: false };
    }
    out.push({ name: step.name, result });
    if (result.kind === "recipe" && result.result.status === "failed") {
      return { site: siteLabel(site), steps: out, complete: false };
    }
  }

  return { site: siteLabel(site), steps: out, complete: true };
}

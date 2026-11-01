// src/dashboard/site-retest-trigger.ts
//
// P1-88: the cockpit's Re-test button for one site. It dispatches `site-retest.yml`
// on the CENTRAL repo with the site's slug as its one input; the workflow reads the
// site's current reasons itself and runs only the audits behind them. It never
// dispatches anything in the site's own repo (that is the Renovate button's job), so
// a re-test cannot fire Renovate (backlog P0-1).
import type { WebsiteRow } from "../fleet/site-row.js";
import { siteSlug } from "../fleet/site-row.js";
import { buildSiteAlarmContext } from "./fleet-cockpit.js";
import { retestPlanFromItems, SITE_RETEST_WORKFLOW, SLUG_PATTERN } from "../retest/site-retest.js";

export type TriggerSiteRetestDeps = {
  getSite: (slug: string) => Promise<WebsiteRow | null>;
  /** Dispatch a workflow on the central repo's default branch, with inputs. */
  dispatch: (workflow: string, inputs: Record<string, string>) => Promise<void>;
  now?: () => Date;
};

export type TriggerSiteRetestResult =
  | { status: "dispatched"; slug: string; site: string; audits: string[] }
  | { status: "bad-slug"; slug: string }
  | { status: "not-found"; slug: string }
  | { status: "nothing-to-retest"; slug: string }
  | { status: "failed"; slug: string; error: string };

/** Never throws: a dispatch failure comes back as `failed`, for a clean status code. */
export async function triggerSiteRetest(
  deps: TriggerSiteRetestDeps,
  slug: string,
): Promise<TriggerSiteRetestResult> {
  if (!SLUG_PATTERN.test(slug)) return { status: "bad-slug", slug };
  const site = await deps.getSite(slug);
  if (!site) return { status: "not-found", slug };
  // The workflow finds the site by the slug the roster derives from its Name (as the
  // fleet audits do), which a stored slug need not equal; send that one.
  const target = siteSlug(site.name);
  if (!SLUG_PATTERN.test(target)) return { status: "not-found", slug };
  const now = (deps.now ?? (() => new Date()))();
  const plan = retestPlanFromItems(buildSiteAlarmContext(site, [], "", now).items);
  if (plan.audits.length === 0) return { status: "nothing-to-retest", slug };
  try {
    await deps.dispatch(SITE_RETEST_WORKFLOW, { site: target });
    return { status: "dispatched", slug, site: target, audits: plan.audits };
  } catch (e) {
    return { status: "failed", slug, error: e instanceof Error ? e.message : String(e) };
  }
}

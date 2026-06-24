import type { WebsiteRow } from "../reports/airtable/websites.js";

/** Injected IO — the `.mts` binds these to a live Airtable base + makeGitHub; tests bind fakes. */
export type TriggerRenovateDeps = {
  getSite: (slug: string) => Promise<WebsiteRow | null>;
  /** Dispatch the repo's renovate.yml (the adapter resolves the default branch). */
  dispatch: (repo: string) => Promise<void>;
};

export type TriggerRenovateResult =
  | { status: "dispatched"; slug: string; repo: string }
  | { status: "no-repo"; slug: string }
  | { status: "not-found"; slug: string }
  | { status: "failed"; slug: string; repo: string; error: string };

/**
 * On-demand Renovate trigger for one site, from the dashboard. Resolves the site
 * by slug, then dispatches its `renovate.yml` UNCONDITIONALLY (operator intent —
 * Renovate dedups/rebases itself, so there's no healthy-PR skip like the nightly
 * sweep). Never throws: a dispatch failure is returned as `failed` so the endpoint
 * maps it to a clean status instead of a 500.
 */
export async function triggerRenovateForSite(
  deps: TriggerRenovateDeps,
  slug: string,
): Promise<TriggerRenovateResult> {
  const site = await deps.getSite(slug);
  if (!site) return { status: "not-found", slug };
  const repo = site.gitRepo?.trim();
  if (!repo) return { status: "no-repo", slug };
  try {
    await deps.dispatch(repo);
    return { status: "dispatched", slug, repo };
  } catch (e) {
    return { status: "failed", slug, repo, error: e instanceof Error ? e.message : String(e) };
  }
}

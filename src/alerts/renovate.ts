import type { PullRequestSummary } from "../github/gh.js";

/**
 * Renovate's default `branchPrefix` is `renovate/`, so every update branch on a
 * default-config repo is `renovate/<topic>` — grouped majors included (they're
 * `renovate/<group-slug>`, still slash-prefixed, not a separate shape). We also
 * match a bare `renovate-` prefix to defensively catch a repo that sets a custom
 * non-slash `branchPrefix`; the tradeoff is that a human branch named `renovate-foo`
 * is misclassified — an acceptable bias for an alerting tool that should prefer
 * over-matching to silently missing a broken update.
 */
const RENOVATE_HEAD_PREFIXES = ["renovate/", "renovate-"];

export function isRenovatePR(pr: Pick<PullRequestSummary, "headRef">): boolean {
  return RENOVATE_HEAD_PREFIXES.some((p) => pr.headRef.startsWith(p));
}

export function isFailingRenovatePR(pr: PullRequestSummary): boolean {
  return isRenovatePR(pr) && pr.ciState === "failing";
}

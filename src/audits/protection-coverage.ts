import { rulesetGaps, type ExistingRuleset } from "../github/rulesets.js";

/**
 * Org-wide protection-coverage sweep (spec:
 * docs/superpowers/specs/2026-08-02-ruleset-self-healing-design.md).
 *
 * The `self-updating` recipe HEALS fleet sites, but it runs only when someone
 * runs it, and only over Airtable-listed sites — which is exactly how the
 * `.github` repo (no Airtable row) sat with zero protection until 2026-08-01.
 * This sweep is the layer that would have caught that on its own: it
 * enumerates the org FROM THE GITHUB API — never a hand-typed or
 * Airtable-scoped list, both of which have already produced false "all
 * clear"s — and judges every public repo's protection by SHAPE, not by name,
 * so a differently-named but sound ruleset (reddoor-maintenance's "Main
 * Protection") counts.
 */
export type ProtectionCoverageRow = {
  repo: string; // owner/repo
  status: "covered" | "gap" | "skipped";
  /** Human-readable: covering ruleset + whether it gates on CI, the specific
   *  gaps, or why the repo was skipped. */
  detail: string;
};

/** The reads the sweep needs — a subset of the GitHub factory, injected so the
 *  sweep is pure + testable (same pattern as collectGitHubSignals). */
export type ProtectionCoverageDeps = {
  listOrgRepos: (
    org: string,
  ) => Promise<Array<{ name: string; visibility: string; archived: boolean }>>;
  listRepoRulesets: (repo: string) => Promise<Array<{ id: number; name: string }>>;
  getRuleset: (repo: string, id: number) => Promise<ExistingRuleset>;
};

/**
 * One row per org repo. Coverage = SOME repo-sourced ruleset with zero
 * stage-1 gaps (active, empty bypass, default branch covered, deletion +
 * non_fast_forward + pull_request). Whether a covering ruleset also gates on
 * CI is reported as detail, not judged: each repo's required context differs
 * (and reddoor-maintenance deliberately has none pending release-path
 * review), so the CI-gate invariant belongs to the per-site heal, which has
 * the evidence to require the RIGHT context safely.
 *
 * Private/archived repos are skipped (rulesets on private repos need a paid
 * plan; archived repos are read-only). A repo whose probe THROWS is a `gap`,
 * not a skip — "couldn't verify" reading as "fine" is the silent-green
 * failure mode this sweep exists to kill, and the tracking issue auto-closes
 * on the next clean pass, so a transient API blip costs one issue-comment.
 */
export async function collectProtectionCoverage(
  org: string,
  deps: ProtectionCoverageDeps,
): Promise<ProtectionCoverageRow[]> {
  const rows: ProtectionCoverageRow[] = [];
  for (const r of await deps.listOrgRepos(org)) {
    const repo = `${org}/${r.name}`;
    if (r.archived || r.visibility !== "public") {
      rows.push({
        repo,
        status: "skipped",
        detail: r.archived ? "archived" : `${r.visibility} (rulesets need a paid plan)`,
      });
      continue;
    }
    try {
      const rulesets = await deps.listRepoRulesets(repo);
      if (rulesets.length === 0) {
        rows.push({ repo, status: "gap", detail: "no repo rulesets at all" });
        continue;
      }
      const judged = await Promise.all(
        rulesets.map(async (rs) => {
          const full = await deps.getRuleset(repo, rs.id);
          return { name: rs.name, full, gaps: rulesetGaps(full, null) };
        }),
      );
      const covering = judged.find((j) => j.gaps.length === 0);
      if (covering) {
        const ciGated = (covering.full.rules ?? []).some(
          (rule) => rule.type === "required_status_checks",
        );
        rows.push({
          repo,
          status: "covered",
          detail: `"${covering.name}"${ciGated ? "" : " — NO CI gate (refs rules only)"}`,
        });
      } else {
        rows.push({
          repo,
          status: "gap",
          detail: judged.map((j) => `"${j.name}": ${j.gaps.join("; ")}`).join(" | "),
        });
      }
    } catch (e) {
      rows.push({
        repo,
        status: "gap",
        detail: `probe failed: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }
  return rows;
}

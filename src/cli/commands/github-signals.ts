import { openBase, readAirtableConfig } from "../../reports/airtable/client.js";
import { listWebsites, siteSlug, updateGitHubSignals } from "../../reports/airtable/websites.js";
import type { Site } from "../../types.js";
import { collectGitHubSignals } from "../../audits/github-signals.js";
import { makeGitHub } from "../../github/gh.js";
import {
  formatFleetWriteSummary,
  type FleetWriteResult,
} from "../../audits/write-audits-to-airtable.js";

/** `github-signals --fleet --write-airtable`: sweep every repo-backed site for its
 *  Renovate-failing count + default-branch CI state + last-commit date, write each
 *  row serially (Airtable ~5 req/sec), and emit FLEET_WRITE_SUMMARY for CI. A
 *  missing fleet token is a clean skip (local runs), not a failure. */
export async function runGitHubSignalsCommand(opts: {
  fleet?: boolean | undefined;
  writeAirtable?: boolean | undefined;
}): Promise<{ output: string; code: number }> {
  if (!opts.fleet || !opts.writeAirtable) {
    return { output: "github-signals currently supports only --fleet --write-airtable", code: 2 };
  }
  const token = process.env.RENOVATE_TOKEN?.trim() || process.env.GH_TOKEN?.trim();
  if (!token) {
    return {
      output: "github-signals skipped: no RENOVATE_TOKEN/GH_TOKEN (fleet read) configured.",
      code: 0,
    };
  }
  const base = openBase(readAirtableConfig());
  const websites = await listWebsites(base);
  const gh = makeGitHub({ token });
  const sites: Site[] = websites.map((w) => ({
    path: "",
    name: w.name,
    meta: {},
    ...(w.gitRepo ? { gitRepo: w.gitRepo } : {}),
  }));

  const skipped: string[] = [];
  const rows = await collectGitHubSignals(
    sites,
    {
      openPullRequests: (r) => gh.openPullRequests(r),
      defaultBranchStatus: (r) => gh.defaultBranchStatus(r),
    },
    ({ repo }) => skipped.push(repo),
  );

  const sweptAt = new Date().toISOString();
  const result: FleetWriteResult = { written: [], failed: [] };
  // Serial: Airtable's ~5 req/sec limit (matches writeFleetAuditsToAirtable).
  for (const row of rows) {
    const target = websites.find((w) => siteSlug(w.name) === siteSlug(row.site));
    if (!target) {
      result.failed.push({ slug: siteSlug(row.site), error: "no Websites row matched" });
      continue;
    }
    try {
      await updateGitHubSignals(base, target.id, {
        renovateFailingCis: row.renovateFailingCis,
        ciState: row.ciState,
        lastCommitAt: row.lastCommitAt,
        sweptAt,
      });
      result.written.push({
        siteName: target.name,
        writes: [{ audit: "github-signals", counts: row } as never],
      });
    } catch (e) {
      result.failed.push({ slug: siteSlug(row.site), error: (e as Error).message });
    }
  }
  for (const repo of skipped) result.failed.push({ slug: repo, error: "probe failed (skipped)" });

  return {
    output: formatFleetWriteSummary(result),
    code: result.failed.length > 0 && result.written.length === 0 ? 1 : 0,
  };
}

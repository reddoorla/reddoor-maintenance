import type { AuditResult } from "../types.js";
import type { AirtableBase } from "../reports/airtable/client.js";
import {
  type WebsiteRow,
  siteSlug,
  updateScores,
  updateA11yCounts,
  updateDepsCounts,
  updateSecurityCounts,
} from "../reports/airtable/websites.js";
import { hasRealScores, lighthouseScoresFromResult } from "./lighthouse-airtable.js";
import { hasA11yCounts, a11yCountsFromResult } from "./a11y-airtable.js";
import { hasDepsCounts, depsCountsFromResult } from "./deps-airtable.js";
import { hasSecurityCounts, securityCountsFromResult } from "./security-airtable.js";

type WriteSummary = {
  siteName: string;
  writes: Array<{ audit: "lighthouse" | "a11y" | "deps" | "security"; counts: object }>;
};

/** Orchestrates the per-audit Airtable writes for `audit --write-airtable`.
 *  Extracted from the CLI command so it can be unit-tested with a fake base
 *  and so adding new audit types is a one-line addition here rather than
 *  growing the CLI handler.
 *
 *  Throws (with .exitCode set) on the failure modes the CLI surfaces today:
 *   - 2: --only ran without lighthouse, or no Websites row matched the slug
 *   - 1: lighthouse ran but produced no real scores (infrastructure failure) */
export async function writeAuditsToAirtable(args: {
  base: AirtableBase;
  websites: WebsiteRow[];
  slug: string;
  results: AuditResult[];
}): Promise<WriteSummary> {
  const { base, websites, slug, results } = args;

  const lhResult = results.find((r) => r.audit === "lighthouse");
  if (!lhResult) {
    throw Object.assign(
      new Error(
        "--write-airtable requires a lighthouse result; did you pass --only without lighthouse?",
      ),
      { exitCode: 2 },
    );
  }
  if (!hasRealScores(lhResult)) {
    throw Object.assign(
      new Error(
        `Lighthouse audit produced no scores; refusing to write to Airtable. Summary: ${lhResult.summary}`,
      ),
      { exitCode: 1 },
    );
  }

  const target = websites.find((w) => siteSlug(w.name) === slug);
  if (!target) {
    throw Object.assign(new Error(`No Websites row matched slug "${slug}"`), { exitCode: 2 });
  }

  const writes: WriteSummary["writes"] = [];

  const scores = lighthouseScoresFromResult(lhResult);
  await updateScores(base, target.id, scores);
  writes.push({ audit: "lighthouse", counts: scores });

  const a11y = results.find((r) => r.audit === "a11y");
  if (a11y && hasA11yCounts(a11y)) {
    const counts = a11yCountsFromResult(a11y);
    await updateA11yCounts(base, target.id, counts);
    writes.push({ audit: "a11y", counts });
  }

  const deps = results.find((r) => r.audit === "deps");
  if (deps && hasDepsCounts(deps)) {
    const counts = depsCountsFromResult(deps);
    await updateDepsCounts(base, target.id, counts);
    writes.push({ audit: "deps", counts });
  }

  const sec = results.find((r) => r.audit === "security");
  if (sec && hasSecurityCounts(sec)) {
    const counts = securityCountsFromResult(sec);
    await updateSecurityCounts(base, target.id, counts);
    writes.push({ audit: "security", counts });
  }

  return { siteName: target.name, writes };
}

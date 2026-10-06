import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AuditResult } from "../types.js";
import type { LighthouseScoreWriteback } from "../reports/types.js";
import type { FailingAudit } from "./lighthouse.js";
import { siteSlug } from "../fleet/site-row.js";

const LIGHTHOUSE_CATEGORIES = ["performance", "accessibility", "best-practices", "seo"] as const;

/**
 * True when the result carries real lighthouse scores worth persisting.
 *
 * The `audit --write-back` policy used to refuse on any `status: "fail"`,
 * but that conflates two very different failure modes:
 *   1. Infrastructure failure (no lhr-*.json written, spawn timeout, etc.)
 *      → `details.summary` empty → all-zeros would corrupt the dashboard
 *   2. Assertion failure (scores below threshold, e.g. best-practices < 0.9)
 *      → `details.summary` has real numbers → tracking these IS the point
 *
 * The dashboard exists to surface drift over time. Refusing to write the
 * very numbers the dashboard wants to plot — just because one assertion
 * tripped — defeats the purpose. Write whenever real scores exist.
 */
export function hasRealScores(result: AuditResult): boolean {
  if (result.audit !== "lighthouse") return false;
  const details = (result.details ?? {}) as { summary?: Record<string, number> };
  const summary = details.summary ?? {};
  return LIGHTHOUSE_CATEGORIES.some(
    (k) => typeof summary[k] === "number" && !Number.isNaN(summary[k]),
  );
}

/**
 * Extract the four Lighthouse scores (as integer percentages) from a
 * `lighthouse` AuditResult. LHCI manifest summaries are floats in [0,1];
 * multiply + round. A category absent from the summary — e.g. Lighthouse
 * errored its audit (NO_LCP nulls the whole performance category) — yields
 * `null`, NOT 0, so the write path can clear the stored cell ("—") instead
 * of persisting a misleading zero. (`hasRealScores` still gates the write on
 * at least one real number, so an all-null infra failure is refused upstream.)
 */
export function lighthouseScoresFromResult(result: AuditResult): LighthouseScoreWriteback {
  if (result.audit !== "lighthouse") {
    throw new Error(`Expected a 'lighthouse' AuditResult, got '${result.audit}'`);
  }
  const details = (result.details ?? {}) as { summary?: Record<string, number> };
  const summary = details.summary ?? {};
  const toPct = (n: number | undefined): number | null =>
    typeof n === "number" && !Number.isNaN(n) ? Math.round(n * 100) : null;
  return {
    performance: toPct(summary["performance"]),
    accessibility: toPct(summary["accessibility"]),
    bestPractices: toPct(summary["best-practices"]),
    seo: toPct(summary["seo"]),
  };
}

type LighthouseFailureDetails = {
  assertions?: Array<{ category: string; actual: number | null; expected: number }>;
  failingAudits?: FailingAudit[];
  assertionsRead?: boolean;
};

function failureDetails(result: AuditResult): LighthouseFailureDetails {
  return (result.details ?? {}) as LighthouseFailureDetails;
}

function auditTokens(audits: FailingAudit[]): string {
  return audits
    .map((f) => `${f.category}/${f.id}:w${f.weight}:${f.runs}/${f.of}${f.errored ? ":error" : ""}`)
    .join(",");
}

export function lighthouseFailingAuditsFromResult(result: AuditResult): string | null | undefined {
  if (result.audit !== "lighthouse") return undefined;
  const { assertions = [], failingAudits = [], assertionsRead } = failureDetails(result);
  if (assertionsRead === false) return undefined;
  if (assertions.length === 0) return null;
  return failingAudits.length > 0 ? auditTokens(failingAudits) : "unnamed";
}

export function formatLighthouseFailureLines(results: AuditResult[]): string {
  return results
    .filter((r) => r.audit === "lighthouse" && (r.status === "fail" || r.status === "warn"))
    .flatMap((r) => {
      const { assertions = [], failingAudits = [] } = failureDetails(r);
      if (assertions.length === 0) return [];
      const asserted = assertions
        .map(
          (a) => `${a.category}:${a.actual === null ? "n/a" : a.actual.toFixed(2)}<${a.expected}`,
        )
        .join(",");
      const audits = failingAudits.length > 0 ? auditTokens(failingAudits) : "unnamed";
      return [`LIGHTHOUSE_FAILURES assertions=${asserted} audits=${audits} site=${r.site}`];
    })
    .join("\n");
}

/**
 * Derive a site slug from the cwd's package.json#name. Used by
 * `audit lighthouse --write-back` when the operator doesn't pass an
 * explicit slug — the cwd is the site checkout, so package.json#name is
 * usually the canonical site name.
 */
export async function resolveSlugFromCwd(cwd: string): Promise<string> {
  try {
    const pkgPath = join(cwd, "package.json");
    const raw = await readFile(pkgPath, "utf-8");
    const pkg = JSON.parse(raw) as { name?: string };
    if (!pkg.name) throw new Error("package.json has no 'name' field");
    return siteSlug(pkg.name);
  } catch (e) {
    throw new Error(
      `Could not derive site slug from ${cwd}/package.json: ${(e as Error).message}. ` +
        `Pass --write-back=<slug> explicitly.`,
      { cause: e },
    );
  }
}

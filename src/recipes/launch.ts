import type { AuditResult, RecipeResult, Site } from "../types.js";
import { siteLabel } from "../util/site.js";
import { selfUpdating } from "./self-updating/index.js";
import { runAudits } from "../audits/index.js";
import { hasRealScores, lighthouseScoresFromResult } from "../audits/lighthouse-airtable.js";
import { writeAuditsToAirtable } from "../audits/write-audits-to-airtable.js";
import { openBase, readAirtableConfig } from "../reports/airtable/client.js";
import type { AirtableBase } from "../reports/airtable/client.js";
import { listWebsites, siteSlug } from "../reports/airtable/websites.js";
import type { WebsiteRow } from "../reports/airtable/websites.js";
import {
  createDraft,
  findReportByPeriod,
  setDraftReady,
  updateReportScores,
} from "../reports/airtable/reports.js";
import type { ReportRow } from "../reports/airtable/reports.js";
import { uploadAttachment } from "../reports/airtable/attachments.js";
import { renderReportHtml } from "../reports/render.js";
import { resolveCopy } from "../reports/copy.js";
import type { LighthouseScores } from "../reports/types.js";

export type LaunchStepResult =
  | { kind: "recipe"; result: RecipeResult }
  | { kind: "audit"; results: AuditResult[]; scores: LighthouseScores }
  | { kind: "draft"; report: ReportRow }
  | { kind: "error"; message: string };

export type LaunchResult = {
  site: string;
  steps: Array<{ name: string; result: LaunchStepResult }>;
  /** True if every step ran (bootstrap + audit + draft); false if a step
   * errored or a recipe `failed` short-circuited the chain. */
  complete: boolean;
};

export type LaunchDeps = {
  /** Bootstrap step (CI + Renovate). Defaults to the real `selfUpdating`. */
  bootstrap?: (site: Site) => Promise<RecipeResult>;
  /** Audit step. Defaults to the real `runAudits`. */
  audit?: (site: Site) => Promise<AuditResult[]>;
  /** Airtable handle. Defaults to opening the live base from credentials. */
  base?: AirtableBase;
};

/**
 * Launch a site: bootstrap → first-audit → DRAFT a launch email. The M3
 * approve loop is what actually sends; `launch` never sends — it stops at a
 * dashboard-queued draft (`reportType: "Launch"`) carrying the just-audited
 * Lighthouse scores, so `sendOne`'s `report.lighthouse` guard passes.
 *
 * Step-chain (mirrors `init`), stopping on the first error or `failed` recipe:
 *   1. selfUpdating — CI + Renovate + auto-merge.
 *   2. runAudits + write the scores to the site's Websites row (reuses the
 *      `audit --write-airtable` writer); the Lighthouse scores feed the draft.
 *   3. createDraft — reportType "Launch", today's period, the audited scores.
 */
export async function launch(site: Site, deps: LaunchDeps = {}): Promise<LaunchResult> {
  const label = siteLabel(site);
  const bootstrap = deps.bootstrap ?? selfUpdating;
  const audit = deps.audit ?? runAudits;
  const base = deps.base ?? openBase(readAirtableConfig());

  const steps: Array<{ name: string; result: LaunchStepResult }> = [];
  const stop = (): LaunchResult => ({ site: label, steps, complete: false });

  // 1. Bootstrap.
  let recipe: RecipeResult;
  try {
    recipe = await bootstrap(site);
  } catch (err) {
    steps.push({ name: "self-updating", result: errorOf(err) });
    return stop();
  }
  steps.push({ name: "self-updating", result: { kind: "recipe", result: recipe } });
  if (recipe.status === "failed") return stop();

  // 2. Audit + write scores back to Airtable.
  let results: AuditResult[];
  try {
    results = await audit(site);
  } catch (err) {
    steps.push({ name: "audit", result: errorOf(err) });
    return stop();
  }
  const lhResult = results.find((r) => r.audit === "lighthouse");
  if (!lhResult || !hasRealScores(lhResult)) {
    steps.push({
      name: "audit",
      result: { kind: "error", message: "lighthouse audit produced no real scores" },
    });
    return stop();
  }
  const scores = lighthouseScoresFromResult(lhResult);

  const websites = await listWebsites(base);
  const target = websites.find((w) => siteSlug(w.name) === siteSlug(label));
  if (!target) {
    steps.push({
      name: "audit",
      result: { kind: "error", message: `no Websites row matched site "${label}"` },
    });
    return stop();
  }
  try {
    await writeAuditsToAirtable({ base, websites, slug: siteSlug(target.name), results });
  } catch (err) {
    steps.push({ name: "audit", result: errorOf(err) });
    return stop();
  }
  steps.push({ name: "audit", result: { kind: "audit", results, scores } });

  // 3. Draft the launch email (reuses draft.ts's reportId/period scheme). DRAFTS
  //    ONLY — the M3 approve loop sends it and flips Status on send.
  const today = new Date();
  const period = today.toISOString().slice(0, 7);
  const slug = siteSlug(target.name);

  let report: ReportRow;
  try {
    // Re-run dedupe: reuse an existing Launch row for this (site, period) instead
    // of stacking a second draft. findReportByPeriod is the same idempotency
    // lookup draft.ts documents (dashboard/digest point lookup).
    const existing = await findReportByPeriod(base, target.id, "Launch", period);
    if (existing) {
      // Reuse path: the row was created on a prior run with THAT run's scores. This
      // re-run just produced fresh audit scores AND will re-render the preview from
      // them — so refresh the row's Lighthouse cells (+ Completed on) to match,
      // otherwise the sent email (which reads the row) ships stale scores. The
      // create path already writes fresh scores via createDraft.
      await updateReportScores(base, existing.id, scores, today);
      report = existing;
    } else {
      report = await createDraft(base, draftInputFor(target, scores, today, period));
    }
  } catch (err) {
    steps.push({ name: "draft", result: errorOf(err) });
    return stop();
  }

  // Mirror draft.ts:135-154 — render → upload "Rendered HTML" preview → flip
  // Draft ready. Without setDraftReady the draft never enters the approve queue
  // (every pending-approval gate requires draftReady true), so it can never be
  // approved or sent. The upload is a review convenience; the ready flag is the
  // critical step.
  try {
    const { html } = await renderReportHtml({
      siteName: target.name,
      siteUrl: target.url,
      reportType: "Launch",
      completedOn: today,
      lighthouse: scores,
      lastTestedDate: null,
      commentary: null,
      copy: resolveCopy(target),
      headerImageCid: `${slug}-header`,
    });
    // A preview-upload hiccup must NOT fail the launch — log and continue.
    try {
      await uploadAttachment(
        report.id,
        "Rendered HTML",
        html,
        `${slug}-${today.toISOString().slice(0, 10)}.html`,
        "text/html",
      );
    } catch (uploadErr) {
      console.warn(
        `⚠ Launch preview upload skipped for ${target.name}: ${
          uploadErr instanceof Error ? uploadErr.message : String(uploadErr)
        }`,
      );
    }
    // Critical: NOT wrapped — a failure here must surface as a failed launch.
    await setDraftReady(base, report.id, true);
  } catch (err) {
    steps.push({ name: "draft", result: errorOf(err) });
    return stop();
  }

  steps.push({ name: "draft", result: { kind: "draft", report } });

  return { site: label, steps, complete: true };
}

/** Build the Launch `DraftInput`. reportId/period mirror `draftReportForSite`
 *  (draft.ts) — do not invent a new id scheme. `today`/`period` are threaded in
 *  from `launch()` so a single timestamp drives the render, the draft, the
 *  dedupe lookup, and the preview filename. Launch reports have no period window
 *  and no prior maintenance test, so periodStart/periodEnd/completedOn all
 *  collapse to "today" and `lastTestedDate` is null. */
function draftInputFor(
  target: WebsiteRow,
  scores: LighthouseScores,
  today: Date,
  period: string,
): Parameters<typeof createDraft>[1] {
  const reportType = "Launch" as const;
  const reportId = `${target.name} — ${reportType} — ${today.toISOString().slice(0, 10)}`;
  return {
    reportId,
    siteId: target.id,
    reportType,
    period,
    periodStart: today,
    periodEnd: today,
    completedOn: today,
    lighthouse: scores,
    lastTestedDate: null,
  };
}

function errorOf(err: unknown): LaunchStepResult {
  return { kind: "error", message: err instanceof Error ? err.message : String(err) };
}

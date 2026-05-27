import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ReportType, LighthouseScores } from "./types.js";
import { renderReportHtml } from "./render.js";
import { siteSlug } from "./airtable/websites.js";
import type { WebsiteRow } from "./airtable/websites.js";
import type { ReportRow } from "./airtable/reports.js";
import {
  createDraft,
  setDraftReady,
  listReportsForSite,
} from "./airtable/reports.js";
import type { AirtableBase } from "./airtable/client.js";

export type DraftOptions = {
  /** Where to write the local preview HTML when `previewOnly`. Defaults to `reports/<slug>/draft.html`. */
  previewPath?: string;
  /** If true: render locally only, never touch Airtable. */
  previewOnly?: boolean;
};

export type DraftResult = {
  /** null when previewOnly. */
  reportRow: ReportRow | null;
  /** Path to the local preview file (only set when previewOnly). */
  htmlPath: string | null;
  /** Always present — the rendered HTML string. */
  html: string;
};

function scoresFromWebsite(siteRow: WebsiteRow): LighthouseScores {
  const { pScore, rScore, bpScore, seoScore } = siteRow;
  if (pScore === null || rScore === null || bpScore === null || seoScore === null) {
    throw new Error(
      `Site '${siteRow.name}' is missing one or more Lighthouse scores on the Websites row (pScore, rScore, bpScore, seoScore). ` +
        `Run 'reddoor-maint audit lighthouse' from the site's checkout and paste the four numbers into Airtable, then retry.`,
    );
  }
  return { performance: pScore, accessibility: rScore, bestPractices: bpScore, seo: seoScore };
}

function daysAgo(today: Date, n: number): Date {
  const out = new Date(today);
  out.setDate(out.getDate() - n);
  return out;
}

export async function draftReportForSite(
  base: AirtableBase | null,
  siteRow: WebsiteRow,
  reportType: ReportType,
  options: DraftOptions = {},
): Promise<DraftResult> {
  const scores = scoresFromWebsite(siteRow);

  const today = new Date();
  const slug = siteSlug(siteRow.name);

  const periodStart =
    base !== null
      ? await derivePeriodStart(base, siteRow, reportType, today)
      : daysAgo(today, 30);

  const periodEnd = today;
  const completedOn = today;
  const lastTestedDate =
    reportType === "Maintenance" && siteRow.testingDay ? new Date(siteRow.testingDay) : null;

  const cidName = `${slug}-header`;
  const { html } = await renderReportHtml({
    siteName: siteRow.name,
    siteUrl: siteRow.url,
    reportType,
    completedOn,
    lighthouse: scores,
    gaUsersCurrent: 0,
    gaUsersPrevious: 0,
    lastTestedDate,
    commentary: null,
    headerImageCid: cidName,
  });

  if (options.previewOnly) {
    const path = options.previewPath ?? `reports/${slug}/draft.html`;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, html, "utf-8");
    return { reportRow: null, htmlPath: path, html };
  }

  if (base === null) throw new Error("base required when previewOnly=false");

  const reportId = `${siteRow.name} — ${reportType} — ${periodEnd.toISOString().slice(0, 10)}`;
  const created = await createDraft(base, {
    reportId,
    siteId: siteRow.id,
    reportType,
    periodStart,
    periodEnd,
    completedOn,
    lighthouse: scores,
    lastTestedDate,
  });

  await uploadHtmlAttachment(created.id, html, slug, periodEnd);
  await setDraftReady(base, created.id, true);

  return { reportRow: created, htmlPath: null, html };
}

async function derivePeriodStart(
  base: AirtableBase,
  siteRow: WebsiteRow,
  reportType: ReportType,
  today: Date,
): Promise<Date> {
  const prior = await listReportsForSite(base, siteRow.id);
  const sameType = prior
    .filter((r) => r.reportType === reportType && r.periodEnd)
    .map((r) => r.periodEnd!)
    .sort();
  const latest = sameType[sameType.length - 1];
  return latest ? new Date(latest) : daysAgo(today, 30);
}

/**
 * Airtable attachments can be created from a public URL OR uploaded directly via the
 * content.airtable.com "upload attachment" endpoint, which accepts base64 — we use that
 * because we don't have anywhere public to host the HTML.
 * Docs: https://airtable.com/developers/web/api/upload-attachment
 */
async function uploadHtmlAttachment(
  recordId: string,
  html: string,
  slug: string,
  periodEnd: Date,
): Promise<void> {
  const apiKey = process.env.AIRTABLE_PAT;
  const baseId = process.env.AIRTABLE_BASE_ID;
  const filename = `${slug}-${periodEnd.toISOString().slice(0, 10)}.html`;
  const body = {
    contentType: "text/html",
    file: Buffer.from(html, "utf-8").toString("base64"),
    filename,
  };
  const url = `https://content.airtable.com/v0/${baseId}/${recordId}/Rendered%20HTML/uploadAttachment`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Airtable upload failed: ${res.status} ${res.statusText} ${await res.text()}`);
  }
}

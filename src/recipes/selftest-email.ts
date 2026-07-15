import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { openBase, readAirtableConfig } from "../reports/airtable/client.js";
import type { AirtableBase } from "../reports/airtable/client.js";
import { listWebsites, siteSlug } from "../reports/airtable/websites.js";
import { ELIGIBLE_STATUSES } from "../reports/due.js";
import type { WebsiteRow } from "../reports/airtable/websites.js";
import { fetchAttachmentBytes } from "../reports/airtable/attachments.js";
import { prepareHeaderImage } from "../reports/maintenance-email/header-image.js";
import { buildReportDataForSite, scoresFromRow } from "../reports/report-data.js";
import { renderReportEmail } from "../reports/send/render-email.js";
import { defaultResendClient, type ResendClient } from "../reports/send/resend.js";
import { parseAddresses, isProbablyEmail } from "../reports/send/orchestrate.js";
import type { ReportType } from "../reports/types.js";

const FROM_ADDRESS = "Reddoor Reports <reports@reddoorla.com>";
const REPLY_TO = "info@reddoorla.com";

export type SelftestEmailDeps = {
  /** Airtable handle (read-only here). Defaults to the live base from credentials. */
  base?: AirtableBase;
  /** Resend client. Defaults to the real client. */
  resend?: ResendClient;
  /** Single-site slug. Mutually exclusive with `all`. */
  site?: string;
  /** All `maintenance` sites (one email each). Mutually exclusive with `site`. */
  all?: boolean;
  /** Report type to preview. Default "Announcement". */
  type?: ReportType;
  /** Raw `--to` (comma- or newline-separated). Default: OPERATOR_EMAIL → info@reddoorla.com. */
  to?: string;
  /** Render only; write reports/<slug>/selftest-<type>.html, never send. */
  dryRun?: boolean;
  /** Single timestamp driving the window + completedOn. */
  now?: Date;
};

export type SelftestEmailSiteResult =
  | { site: string; status: "sent" | "dry-run"; subject: string; recipients: string[] }
  | { site: string; status: "skipped"; reason: string }
  | { site: string; status: "error"; message: string };

export type SelftestEmailResult = { results: SelftestEmailSiteResult[] };

/** Resolve the recipient list: explicit `--to` (validated) else the operator default. */
function resolveRecipients(to: string | undefined): string[] {
  const operator = process.env.OPERATOR_EMAIL?.trim() || "info@reddoorla.com";
  const parsed = to ? parseAddresses(to) : null;
  const list = parsed ?? [operator];
  for (const addr of list) {
    if (!isProbablyEmail(addr)) {
      throw Object.assign(new Error(`--to has a malformed address: ${addr}`), { exitCode: 2 });
    }
  }
  return list;
}

/**
 * Send (or dry-render) a single report email per target site to the operator/`--to`, with NO
 * Airtable side effects (no draft, queue, or stamp). Mirrors the production render+send via the
 * shared `renderReportEmail` seam, so the preview matches a real send. One bad site never aborts
 * `--all` (per-site try/catch). Sites missing stored scores or a header image are skipped.
 */
export async function selftestEmail(deps: SelftestEmailDeps): Promise<SelftestEmailResult> {
  const base = deps.base ?? openBase(readAirtableConfig());
  const resend = deps.resend ?? defaultResendClient();
  const type: ReportType = deps.type ?? "Announcement";
  const now = deps.now ?? new Date();
  const recipients = resolveRecipients(deps.to);

  const websites = await listWebsites(base);
  let targets: WebsiteRow[];
  if (deps.all) {
    // The report-eligible set (maintenance + hosting), not a hard-coded "maintenance" —
    // the latter silently excluded hosting sites and implied a type↔status coupling that
    // doesn't exist (the requested --type drives the rendered template; single-site mode
    // applies no status filter at all).
    targets = websites.filter((w) => w.status !== null && ELIGIBLE_STATUSES.has(w.status));
  } else if (deps.site) {
    const wanted = siteSlug(deps.site);
    targets = websites.filter((w) => siteSlug(w.name) === wanted);
  } else {
    throw Object.assign(new Error("Provide a site slug or --all"), { exitCode: 2 });
  }

  const results: SelftestEmailSiteResult[] = [];
  for (const w of targets) {
    try {
      const scores = scoresFromRow(w);
      if (!scores) {
        results.push({ site: w.name, status: "skipped", reason: "missing Lighthouse scores" });
        continue;
      }
      if (!w.headerImage) {
        results.push({ site: w.name, status: "skipped", reason: "no Header image" });
        continue;
      }
      const original = await fetchAttachmentBytes(w.headerImage.url);
      const header = await prepareHeaderImage(original.bytes);
      const slug = siteSlug(w.name);
      const reportData = await buildReportDataForSite(w, type, now, { scores, header });
      const { html, attachments, subject } = await renderReportEmail(reportData, {
        header,
        cidName: `${slug}-header`,
      });

      if (deps.dryRun) {
        const path = `reports/${slug}/selftest-${type.toLowerCase()}.html`;
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, html, "utf-8");
        results.push({ site: w.name, status: "dry-run", subject, recipients });
        continue;
      }

      await resend.send({
        from: FROM_ADDRESS,
        to: recipients,
        replyTo: REPLY_TO,
        subject,
        html,
        attachments,
      });
      results.push({ site: w.name, status: "sent", subject, recipients });
    } catch (err) {
      results.push({
        site: w.name,
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { results };
}

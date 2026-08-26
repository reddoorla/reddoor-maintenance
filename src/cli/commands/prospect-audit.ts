import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { hostnameOf, isHttpUrl } from "../../util/url.js";
import { reportUrl, reportPrintUrl } from "../../prospect/report-url.js";
import type { ProspectAuditStatus } from "../../db/prospect-audits.js";
import type { PipelineDeps, StageName } from "../../prospect/pipeline.js";
import type { ProspectAuditResult } from "../../prospect/types.js";
import type { SendAuditEmailResult } from "../../prospect/email.js";

export type ProspectAuditCliOptions = {
  business?: string;
  /** Comma-separated competitor domains. */
  competitors?: string;
  /** cac sets this false for `--no-probes`. */
  probes?: boolean;
  out?: string;
  json?: boolean;
  /**
   * Email the internal sheet (scores, what wasn't measured and why, top
   * fixes, and the shareable link) to `PROSPECT_AUDIT_RECIPIENTS`, once the
   * report is rendered and the `--out`/Turso delivery attempts finish. A
   * missing/empty recipients var, or a Resend failure, is a warning — never a
   * crash — because by the time this runs the audit is already delivered (or
   * recovered) by the code above it.
   */
  email?: boolean;
  /** Test seam: injected pipeline deps. Never set from the CLI. */
  deps?: PipelineDeps;
};

type RecoveryWrite = { htmlPath: string; jsonPath: string };

function fail(message: string): { output: string; code: number } {
  return { output: message, code: 2 };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function scoreLine(label: string, value: number | null): string {
  return `${label.padEnd(14)} ${value === null ? "not measured" : String(value).padStart(3)}`;
}

/** Item 3: the `status` column exists to answer, without deserializing the
 *  whole result_json, whether this was a clean run or a degraded one. crawl
 *  is excluded — it's the one fatal stage (see pipeline.ts), so by the time a
 *  ProspectAuditResult exists it was always ok. Every other stage's
 *  StageResult already collapses "failed" and "deliberately skipped"
 *  (--no-probes, the checks→analyze cascade) into the same `ok: false` — both
 *  mean the report has a "not measured" section, so both count as partial
 *  here too. */
function auditStatus(result: ProspectAuditResult): ProspectAuditStatus {
  const allStagesOk =
    result.checks.ok && result.lighthouse.ok && result.analyze.ok && result.probes.ok;
  return allStagesOk ? "complete" : "partial";
}

/** Filesystem-safe, never empty. Collapses anything outside [a-z0-9.-] to a
 *  single dash so a hostname becomes a sane filename fragment. */
function slugify(s: string): string {
  const slug = s
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "prospect";
}

/**
 * Last-resort write when NEITHER `--out` nor the database persist made it —
 * the one situation a paid, already-run audit must never end in silently. Lands
 * in `reports/`, mirroring header-image.ts's own convention for CLI-written
 * artifacts (mkdir -p, resolved against cwd), rather than a bare file dropped
 * into whatever directory the operator happened to be standing in when they
 * ran the command — often unrelated to this repo at all in fleet-tool usage.
 */
async function writeRecoveryFiles(
  result: ProspectAuditResult,
  html: string,
): Promise<RecoveryWrite> {
  const dir = resolve("reports");
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = `prospect-audit-${slugify(hostnameOf(result.url))}-${stamp}`;
  const htmlPath = resolve(dir, `${base}.html`);
  const jsonPath = resolve(dir, `${base}.json`);
  await writeFile(htmlPath, html, "utf-8");
  await writeFile(jsonPath, JSON.stringify(result, null, 2), "utf-8");
  return { htmlPath, jsonPath };
}

function summarize(
  result: ProspectAuditResult,
  link: string | null,
  file: string | null,
  warnings: string[],
  recovery: RecoveryWrite | null,
  email: SendAuditEmailResult | null,
): string {
  const lines = [
    `Prospect audit — ${result.businessName ?? result.url}`,
    "",
    scoreLine("Findability", result.scores.findability),
    scoreLine("Readability", result.scores.readability),
    scoreLine("Answers", result.scores.answers),
    scoreLine("AI Visibility", result.scores.aiVisibility),
  ];
  for (const [name, stage] of [
    ["checks", result.checks],
    ["lighthouse", result.lighthouse],
    ["analyze", result.analyze],
    ["probes", result.probes],
  ] as const) {
    if (!stage.ok) lines.push(`  ! ${name} not measured — ${stage.error}`);
  }
  if (file) lines.push("", `Report written to ${file}`);
  if (link) lines.push("", `Shareable link: ${link}`);
  if (email?.sent) {
    lines.push("", `Emailed to ${email.recipients.join(", ")} (${email.messageId})`);
  }
  for (const w of warnings) lines.push("", `! ${w}`);
  if (recovery) {
    lines.push(
      "",
      "Neither --out nor the database took this report — wrote a recovery copy instead:",
      `  ${recovery.htmlPath}`,
      `  ${recovery.jsonPath}`,
    );
  }
  return lines.join("\n");
}

/**
 * Run one prospect audit end to end. Progress goes to stderr so `--json` stdout
 * stays pipeable. Persistence needs Turso; without it `--out` is mandatory,
 * because an audit nobody can read afterwards is just a bill.
 *
 * By the time `runProspectAudit` resolves, the money is already spent — only
 * the crawl is fatal, every other stage degrades rather than throwing. So the
 * `--out` write and the database persist below are each wrapped in their own
 * try/catch and attempted independently: a bad `--out` path must not cost a
 * working Turso persist (or vice versa), and if BOTH fail — or persist fails
 * with no `--out` given at all — a recovery copy goes to `reports/` rather
 * than the run ending with nothing anywhere. `--json` only changes the SHAPE
 * of stdout; it still runs the same `--out`/persist/recovery logic beneath it.
 */
export async function runProspectAuditCommand(
  url: string,
  opts: ProspectAuditCliOptions,
): Promise<{ output: string; code: number }> {
  if (!isHttpUrl(url)) {
    return fail(`"${url}" is not a URL. Pass the full address, e.g. https://example.com`);
  }
  const canPersist = Boolean(process.env.TURSO_DATABASE_URL);
  if (!canPersist && !opts.out) {
    return fail(
      "No TURSO_DATABASE_URL, so the report cannot be saved or shared. Re-run with --out <file>, or set the Turso credentials.",
    );
  }

  const { runProspectAudit } = await import("../../prospect/pipeline.js");
  const onStage = (name: StageName, status: "start" | "ok" | "fail", detail?: string): void => {
    if (status === "start") console.error(`… ${name}`);
    else if (status === "ok") console.error(`✓ ${name}`);
    else console.error(`! ${name} — ${detail ?? "failed"}`);
  };

  const business = opts.business?.trim();
  const result = await runProspectAudit(
    url,
    {
      ...(business ? { business } : {}),
      ...(opts.competitors
        ? {
            competitors: opts.competitors
              .split(",")
              .map((c) => c.trim())
              .filter(Boolean),
          }
        : {}),
      ...(opts.probes === false ? { probes: false } : {}),
    },
    { ...(opts.deps ?? {}), onStage },
  );

  const { renderProspectReport } = await import("../../prospect/render.js");
  const html = renderProspectReport(result);

  const warnings: string[] = [];

  let file: string | null = null;
  if (opts.out) {
    try {
      await writeFile(opts.out, html, "utf-8");
      file = opts.out;
    } catch (err) {
      warnings.push(`Could not write --out (${opts.out}): ${errorMessage(err)}`);
    }
  }

  let link: string | null = null;
  let token: string | null = null;
  let auditId: string | null = null;
  if (canPersist) {
    try {
      const { openDb, readDbConfig } = await import("../../db/client.js");
      const { createProspectAudit } = await import("../../db/prospect-audits.js");
      const db = await openDb(readDbConfig());
      const created = await createProspectAudit(db, {
        url: result.url,
        // Map at the boundary: ProspectAuditResult.businessName is the field
        // name (Item 2 — it's a resolved NAME, not a description); the
        // `prospect_audits.business` column keeps its existing name, since
        // renaming a column needs its own migration for no benefit here.
        business: result.businessName,
        status: auditStatus(result),
        resultJson: JSON.stringify(result),
      });
      auditId = created.id;
      token = created.token;
      link = reportUrl(token);
    } catch (err) {
      warnings.push(`Could not save to the database: ${errorMessage(err)}`);
    }
  }

  const delivered = file !== null || link !== null;
  const recovery = delivered ? null : await writeRecoveryFiles(result, html);
  const code = delivered ? 0 : 1;

  // The audit is already delivered (or recovered) above — an email failure
  // must never take that away. Same independent try/catch shape as the
  // --out write and the Turso persist: record a warning, keep going, never
  // touch `code`. Dynamically imported for the same reason db/client.js and
  // prospect/render.js are above: it reaches `resend` (a devDependency) and
  // must stay out of bin.js's static import graph (see bin.ts's
  // central-dep-blocker comment).
  // The PDF leave-behind, printed from the website's print route — a document
  // designed for paper, not the interactive report with its evidence folded
  // away behind disclosures.
  //
  // Best-effort by design. Every other stage in this pipeline degrades rather
  // than throwing, and an attachment is not worth losing a delivered report
  // over: if this fails the email still goes, with the link, and a warning says
  // the PDF is missing. It also needs a token — with no persisted report there
  // is no page to print.
  let pdf: Buffer | null = null;
  if (opts.email && token) {
    try {
      const { renderReportPdf } = await import("../../prospect/pdf.js");
      pdf = await renderReportPdf(reportPrintUrl(token));
    } catch (err) {
      warnings.push(`Could not attach the PDF: ${errorMessage(err)}`);
    }
  }

  let email: SendAuditEmailResult | null = null;
  if (opts.email) {
    try {
      const { sendAuditEmail, parseProspectAuditRecipients } =
        await import("../../prospect/email.js");
      const recipients = parseProspectAuditRecipients(process.env.PROSPECT_AUDIT_RECIPIENTS);
      email = await sendAuditEmail(result, { link, recipients, auditId, pdf });
      if (!email.sent) {
        warnings.push(`Could not email the audit sheet: ${email.reason}`);
      }
    } catch (err) {
      warnings.push(`Could not email the audit sheet: ${errorMessage(err)}`);
    }
  }

  if (opts.json) {
    return {
      output: JSON.stringify(
        { result, out: file, link, token, recovery, warnings, email },
        null,
        2,
      ),
      code,
    };
  }

  return { output: summarize(result, link, file, warnings, recovery, email), code };
}

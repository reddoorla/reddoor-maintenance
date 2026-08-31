import { escapeHtml, safeUrl } from "../util/html.js";
import { hostnameOf } from "../util/url.js";
import { renderProspectReport } from "./render.js";
import { defaultResendClient, type ResendClient } from "../reports/send/resend.js";
import type { AnalyzeResult, Fix, ProspectAuditResult, StageResult } from "./types.js";

/**
 * Mirrors `reports/send/orchestrate.ts`'s `FROM_ADDRESS` (its line 18) — copied,
 * not imported, exactly like `digest.ts` and `recipes/selftest-email.ts` already
 * do. orchestrate.ts's own `FROM_ADDRESS` isn't exported, and importing it would
 * drag its whole Airtable/MJML dependency chain into this module's graph, which
 * stays lazy-loaded on purpose (see bin.ts's central-dep-blocker comment — this
 * module reaches `resend`, a devDependency, and must only ever be reached via a
 * dynamic `import()` from the CLI).
 */
const FROM_ADDRESS = "Reddoor Reports <reports@reddoorla.com>";

const IMPACT_ORDER: Record<Fix["impact"], number> = { high: 0, medium: 1, low: 2 };

/** "top few fixes" per the design — enough to be useful on an internal sheet
 *  without turning it into the full client report. */
const TOP_FIX_COUNT = 3;

export type AuditEmailContent = {
  subject: string;
  html: string;
  /** The FULL client-facing report (render.ts's `renderProspectReport`, pure
   *  and deterministic like this function), so `sendAuditEmail` can attach it
   *  without a second render call on the default path. */
  attachmentHtml: string;
};

/** The searchable business name when the pipeline resolved one, else the
 *  hostname — mirrors render.ts's identical fallback (types.ts's businessName
 *  doc: "Null when no name was ever resolved... itself a finding, not an
 *  error"). Used for both the subject line and the sheet's own heading. */
function resolveName(result: ProspectAuditResult): string {
  return result.businessName && result.businessName.trim()
    ? result.businessName
    : hostnameOf(result.url);
}

/**
 * Mail subject headers are plain text, never HTML-rendered by a client — no
 * `escapeHtml` needed there (that would wrongly show literal "&lt;" etc. in
 * the subject line). A raw newline/control character IS worth collapsing:
 * a business name that embeds one (scraped page title, model output) would
 * otherwise visibly break the subject, and a stray CR/LF in a header value
 * is the classic email-header-injection vector — defense-in-depth even
 * though the Resend API's JSON transport already neutralizes it here.
 */
function subjectSafe(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Local copy of render.ts's date formatter — small enough that importing it
 *  (render.ts doesn't export it) isn't worth the coupling. */
function formatIsoDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

type NotMeasuredLine = { label: string; reason: string };

/**
 * Everything on the sheet that reads "not measured", and why — in plain
 * words. Unlike render.ts's client-facing report (which collapses every
 * stage failure to STAGE_FAILED_MESSAGE so a stranger never sees operator
 * vocabulary), this email goes to Tucker/Tim/Erik: the real diagnostic
 * (a fetch error, an LLM timeout) is more useful to them than a sanitized
 * phrase, so stage `error` strings are surfaced verbatim (still escaped —
 * they can embed arbitrary text from a fetch response).
 *
 * The four-Scores branches mirror checks.ts's `computeScores` exactly: which
 * stage feeds which score, and the cases where that stage's OWN data still
 * nulls the score even though the stage itself succeeded (crawlerAccessMeasured
 * false, avgMissing null, empty buyerQuestions, a null visibilityScore). If
 * computeScores' conditions change, this needs the matching update.
 */
function notMeasuredLines(result: ProspectAuditResult): NotMeasuredLine[] {
  const lines: NotMeasuredLine[] = [];

  if (!result.checks.ok) {
    lines.push({
      label: "Findability",
      reason: `the checks stage failed — ${result.checks.error}`,
    });
    lines.push({
      label: "Readability",
      reason: `the checks stage failed — ${result.checks.error}`,
    });
  } else {
    const c = result.checks.data;
    if (result.scores.findability === null) {
      lines.push({
        label: "Findability",
        reason: !c.crawlerAccessMeasured
          ? "robots.txt could not be fetched, so crawler access wasn't measured"
          : "every crawled page failed to produce readable content",
      });
    }
    if (result.scores.readability === null) {
      lines.push({
        label: "Readability",
        reason: "no page produced a comparable raw/rendered pair to measure JavaScript dependence",
      });
    }
  }

  if (!result.lighthouse.ok) {
    lines.push({ label: "Lighthouse", reason: result.lighthouse.error });
  }

  if (!result.analyze.ok) {
    lines.push({ label: "Answers", reason: result.analyze.error });
  } else if (result.scores.answers === null) {
    lines.push({ label: "Answers", reason: "the model found no buyer questions to check" });
  }

  // Named for what the stage measures (the receipts section), not for the
  // removed score label — the email no longer presents an AI Visibility score.
  if (!result.probes.ok) {
    lines.push({ label: "AI engine answers", reason: result.probes.error });
  } else if (result.scores.aiVisibility === null) {
    lines.push({ label: "AI engine answers", reason: "no category (buyer-question) query ran" });
  }

  return lines;
}

/** The three SITE scores. aiVisibility is deliberately absent — the report
 *  reorganised around what the client controls, and a visibility number in a
 *  score row reads as ours to move. It stays computed and stored; the report
 *  page presents the receipts. */
const SCORE_FIELDS: { key: keyof ProspectAuditResult["scores"]; label: string }[] = [
  { key: "findability", label: "Findability" },
  { key: "readability", label: "Readability" },
  { key: "answers", label: "Answers" },
];

function scoresTableHtml(scores: ProspectAuditResult["scores"]): string {
  const cells = SCORE_FIELDS.map(({ key, label }) => {
    const value = scores[key];
    const display = value === null ? "Not measured" : String(value);
    const valueStyle =
      value === null ? "color:#8a857e;font-size:14px;" : "color:#d71920;font-size:28px;";
    return `<td style="padding:12px 16px;border:1px solid #e6e1da;text-align:center;">
      <div style="font-weight:600;${valueStyle}">${escapeHtml(display)}</div>
      <div style="font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#57544f;margin-top:4px;">${escapeHtml(label)}</div>
    </td>`;
  }).join("");
  return `<table role="presentation" style="border-collapse:collapse;margin:16px 0;"><tr>${cells}</tr></table>`;
}

function notMeasuredHtml(lines: NotMeasuredLine[]): string {
  if (lines.length === 0) return "";
  const items = lines
    .map((l) => `<li><strong>${escapeHtml(l.label)}</strong> — ${escapeHtml(l.reason)}</li>`)
    .join("");
  return `<h2 style="font-size:16px;margin:24px 0 8px;">Not measured</h2><ul style="margin:0;padding-left:20px;">${items}</ul>`;
}

/** analyze.error and fix titles/why are untrusted (LLM output, or text lifted
 *  from the prospect's own site) — every interpolation below is escaped. */
function fixesHtml(analyze: StageResult<AnalyzeResult>): string {
  if (!analyze.ok) {
    return `<p style="color:#8a857e;margin:8px 0 0;">Fixes not available — ${escapeHtml(analyze.error)}</p>`;
  }
  const top = [...analyze.data.fixes]
    .sort((a, b) => IMPACT_ORDER[a.impact] - IMPACT_ORDER[b.impact])
    .slice(0, TOP_FIX_COUNT);
  if (top.length === 0) {
    return `<p style="margin:8px 0 0;">Nothing urgent — the essentials are already in place.</p>`;
  }
  const items = top
    .map(
      (f) =>
        `<li><strong>${escapeHtml(f.title)}</strong> — ${escapeHtml(f.why)} <span style="color:#8a857e;">(${escapeHtml(f.impact)} impact, ${escapeHtml(f.effort)} effort)</span></li>`,
    )
    .join("");
  return `<ol style="margin:8px 0 0;padding-left:20px;">${items}</ol>`;
}

function linkHtml(link: string | null): string {
  if (!link) {
    return `<p style="margin:24px 0 0;color:#8a857e;">No shareable link — the audit could not be saved to the database. The full report is attached to this email instead.</p>`;
  }
  const safe = safeUrl(link);
  return `<p style="margin:24px 0 0;"><strong>Full report:</strong> <a href="${escapeHtml(safe)}">${escapeHtml(link)}</a></p>`;
}

/** This sheet is for us, and it says so. It carries the real reasons a stage did
 *  not run — useful internally, wrong in front of a prospect — so it has to be
 *  obvious that the shareable artefact is the attachment and the link, not this
 *  body. Without the label, the natural thing to do with a useful email is
 *  forward it. */
const INTERNAL_NOTE = `<p style="margin:24px 0 0;padding:12px 14px;background:#f4f2ef;border-left:3px solid #d71920;color:#57544f;font-size:14px;">
  Internal sheet — it names the reasons a section could not be measured. The
  version to send a prospect is the linked report, also attached to this email.
</p>`;

/**
 * Build the internal sheet — a SHORT summary for Tucker/Tim/Erik, distinct
 * from the client-facing report render.ts builds. Pure: no IO, so it's safe
 * to call from a test with no network. `attachmentHtml` is the full report
 * (render.ts's `renderProspectReport`, itself pure), included here so
 * `sendAuditEmail`'s default path doesn't need a second render call.
 *
 * Every value that can trace back to the prospect's site or the model —
 * the business name, fixes, stage error text, the narrative-adjacent bits —
 * is escaped with `escapeHtml`/`safeUrl`, the same honesty-and-safety rule
 * render.ts follows for the client-facing report.
 */
export function buildAuditEmail(
  result: ProspectAuditResult,
  opts: { link: string | null },
): AuditEmailContent {
  const name = resolveName(result);
  const subject = `Prospect audit — ${subjectSafe(name)}`;

  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
<body style="margin:0;padding:24px;background:#faf8f5;color:#1a1a1a;font:15px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <h1 style="font-size:22px;margin:0 0 4px;">Prospect audit — ${escapeHtml(name)}</h1>
  <p style="margin:0 0 16px;color:#57544f;">
    <a href="${escapeHtml(safeUrl(result.url))}">${escapeHtml(result.url)}</a> · audited ${escapeHtml(formatIsoDate(result.generatedAt))}
  </p>
  ${scoresTableHtml(result.scores)}
  ${notMeasuredHtml(notMeasuredLines(result))}
  <h2 style="font-size:16px;margin:24px 0 8px;">Top fixes</h2>
  ${fixesHtml(result.analyze)}
  ${linkHtml(opts.link)}
  ${INTERNAL_NOTE}
</body>
</html>`;

  return { subject, html, attachmentHtml: renderProspectReport(result) };
}

/**
 * Parse `PROSPECT_AUDIT_RECIPIENTS` (comma-separated) into a clean address
 * list: trimmed, empties dropped, case-insensitively deduped — mirrors
 * `reports/send/orchestrate.ts`'s `parseAddresses` for the same reasons (an
 * operator-typed env var, same typo surface). No address is ever hardcoded
 * anywhere in this module; an unset or empty var yields `[]`, which
 * `sendAuditEmail` treats as "skip, and say why" rather than an error.
 */
export function parseProspectAuditRecipients(raw: string | undefined | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const list: string[] = [];
  for (const part of raw.split(",")) {
    const trimmed = part.trim().toLowerCase();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    list.push(trimmed);
  }
  return list;
}

/** Filesystem-safe attachment-filename fragment. Tiny local copy of the CLI's
 *  private `slugify` (prospect-audit.ts) — not worth exporting/sharing one
 *  three-line predicate across a module boundary. */
function slugify(s: string): string {
  const slug = s
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "prospect";
}

export type SendAuditEmailOptions = {
  link: string | null;
  recipients: string[];
  /**
   * The persisted `prospect_audits` row id (from `createProspectAudit`), when
   * persistence succeeded. Mirrors orchestrate.ts's
   * `idempotencyKey: \`report:${report.id}\`` pattern, so re-sending for the
   * SAME already-persisted audit dedupes at Resend instead of double-mailing.
   * Null when persistence failed — the sheet can still be sent (it's built to
   * survive independently of Turso), but then there is no stable row id, so
   * the key falls back to `url`+`generatedAt`: that still protects a
   * same-process double-call, though — unlike a DB id — it can't survive an
   * entire pipeline rerun, which mints genuinely new content anyway.
   */
  auditId?: string | null;
  /**
   * The print-designed PDF leave-behind, when one was rendered.
   *
   * Optional on purpose: rendering it needs a live page and a headless browser,
   * and neither is worth losing a delivered report over. Absent, the email goes
   * exactly as it did before — the HTML sheet and the link — and the caller has
   * already recorded a warning saying why.
   */
  pdf?: Buffer | null;
  /** Defaults to `defaultResendClient()`. */
  client?: ResendClient;
  /** Test seam for the ATTACHMENT content only (production omits it and gets
   *  the real `renderProspectReport` output `buildAuditEmail` already
   *  computed) — lets a test of this function's sending mechanics (recipients,
   *  idempotency key, attachment shape) skip re-deriving the full report. */
  renderReport?: (result: ProspectAuditResult) => string;
};

export type SendAuditEmailResult =
  { sent: true; messageId: string; recipients: string[] } | { sent: false; reason: string };

/**
 * Send the audit sheet with the full rendered report attached as an `.html`
 * file (base64), so the sheet survives independently of the link and of
 * Turso. Empty `recipients` is a legitimate, non-exceptional outcome (no
 * `PROSPECT_AUDIT_RECIPIENTS` configured) — returns `{sent:false}` rather
 * than throwing, so a caller can report it as a warning; a genuine send
 * failure (a throwing `client.send`) still propagates as a real exception.
 */
export async function sendAuditEmail(
  result: ProspectAuditResult,
  opts: SendAuditEmailOptions,
): Promise<SendAuditEmailResult> {
  if (opts.recipients.length === 0) {
    return {
      sent: false,
      reason: "no recipients configured (PROSPECT_AUDIT_RECIPIENTS is unset or empty)",
    };
  }

  const built = buildAuditEmail(result, { link: opts.link });
  const attachmentHtml = opts.renderReport ? opts.renderReport(result) : built.attachmentHtml;
  const client = opts.client ?? defaultResendClient();
  const idempotencyKey = `prospect-audit:${opts.auditId ?? `${result.url}#${result.generatedAt}`}`;
  const filename = `prospect-audit-${slugify(hostnameOf(result.url))}.html`;

  const { messageId } = await client.send({
    from: FROM_ADDRESS,
    to: opts.recipients,
    subject: built.subject,
    html: built.html,
    attachments: [
      {
        filename,
        content: Buffer.from(attachmentHtml, "utf-8").toString("base64"),
        contentType: "text/html",
      },
      // The PDF goes second so the HTML sheet stays the first attachment it has
      // always been, and appears only when one was actually rendered — an empty
      // or broken attachment is worse than none.
      ...(opts.pdf
        ? [
            {
              filename: filename.replace(/\.html$/, ".pdf"),
              content: opts.pdf.toString("base64"),
              contentType: "application/pdf",
            },
          ]
        : []),
    ],
    idempotencyKey,
  });

  return { sent: true, messageId, recipients: opts.recipients };
}

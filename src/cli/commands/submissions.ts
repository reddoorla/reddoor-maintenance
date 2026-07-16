import type { Db } from "../../db/client.js";
import type { SubmissionRow } from "../../reports/submission-row.js";

export type SubmissionsCommandOptions = {
  /** Write the re-buckets. Without it the command is a DRY RUN (deliberate default —
   *  this rewrites operator-visible triage state, so the table prints first). */
  apply?: boolean;
  /** Explicit dry run (the default). Conflicts with --apply. */
  dryRun?: boolean;
  /** Override the libSQL url (tests use ":memory:"); otherwise read from env. */
  url?: string;
  cwd?: string;
  verbose?: boolean;
};

/** Provenance marker appended to the NEW classifier reasons on every re-bucketed row,
 *  so a retro'd row is always distinguishable from one the classifier caught at ingest. */
export const RESCORE_REASON_MARKER = "retro-rescore";

export type RescoreFlagged = {
  row: SubmissionRow;
  newScore: number;
  /** What --apply writes to spam_reason: the new verdict's reasons + RESCORE_REASON_MARKER. */
  newReason: string;
  /** True when --apply actually flipped the row (false in dry runs, or when the row
   *  stopped being 'new' between the scan and the write). */
  written: boolean;
};

/** extraFields is stored as a raw JSON string; the classifier wants the object. A
 *  null/garbage/non-object value degrades to {} — same blind-spot posture as ingest
 *  (classification never throws on stored data). */
function parseExtraFields(raw: string | null): Record<string, unknown> {
  if (!raw || raw.trim() === "") return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Core of `submissions rescore`, separated from the command wrapper so tests can run it
 * against a seeded :memory: db. Scans EVERY status='new' row (the pre-2026-07-15-tuning
 * backlog these rows predate), re-runs the CURRENT classifySpam over each — turnstile
 * "unverifiable", exactly what ingest passes when no token reaches verification — and
 * flags rows at/above SPAM_THRESHOLD. With `apply` it re-buckets each flagged row to
 * spam_auto, REPLACING spam_score/spam_reason with the new verdict (+ marker). The
 * classifier is the single source of truth: no scoring logic is duplicated here.
 */
export async function rescoreNewSubmissions(
  db: Db,
  opts: { apply: boolean },
): Promise<{ scanned: number; flagged: RescoreFlagged[] }> {
  const { listSubmissionsFiltered, rescoreSubmissionSpam } =
    await import("../../db/submissions.js");
  const { classifySpam, SPAM_THRESHOLD } = await import("../../forms/spam-classifier.js");

  // Collect the WHOLE backlog before any write: --apply mutates rows out of the
  // status='new' filter, so paging offset-wise while writing would skip rows.
  const rows: SubmissionRow[] = [];
  const PAGE = 500;
  for (let offset = 0; ; offset += PAGE) {
    const page = await listSubmissionsFiltered(db, { status: "new" }, { limit: PAGE, offset });
    rows.push(...page);
    if (page.length < PAGE) break;
  }

  const flagged: RescoreFlagged[] = [];
  for (const row of rows) {
    const verdict = classifySpam({
      name: row.name,
      email: row.email,
      // message is optional on the classifier input; exactOptionalPropertyTypes
      // forbids passing `undefined`, so spread only when present (form-ingest idiom).
      ...(row.message !== null ? { message: row.message } : {}),
      formType: row.formType,
      extraFields: parseExtraFields(row.extraFields),
      turnstile: "unverifiable",
    });
    if (verdict.score < SPAM_THRESHOLD) continue;
    const newReason = [...verdict.reasons, RESCORE_REASON_MARKER].join(",");
    const written = opts.apply
      ? await rescoreSubmissionSpam(db, row.id, verdict.score, newReason)
      : false;
    flagged.push({ row, newScore: verdict.score, newReason, written });
  }
  return { scanned: rows.length, flagged };
}

/** site_id → display name for the table. Soft-fails to an empty map (raw rec ids still
 *  print) so the re-score itself never depends on Airtable being reachable. */
async function loadSiteNames(): Promise<Map<string, string>> {
  try {
    const { openBase, readAirtableConfig } = await import("../../reports/airtable/client.js");
    const { listWebsites } = await import("../../reports/airtable/websites.js");
    const sites = await listWebsites(openBase(readAirtableConfig()));
    return new Map(sites.map((s) => [s.id, s.name] as const));
  } catch (err) {
    console.error(`[submissions] site names unavailable — printing raw site ids: ${String(err)}`);
    return new Map();
  }
}

function pad(v: string, width: number): string {
  return v.length >= width ? v : v + " ".repeat(width - v.length);
}

function formatTable(flagged: RescoreFlagged[], names: Map<string, string>): string {
  const rows = flagged.map((f) => ({
    site: names.get(f.row.siteId) ?? f.row.siteId,
    email: f.row.email || "(no email)",
    score: `${f.row.spamScore ?? "—"} → ${f.newScore}`,
    reasons: f.newReason,
  }));
  const siteW = Math.max(4, ...rows.map((r) => r.site.length));
  const emailW = Math.max(5, ...rows.map((r) => r.email.length));
  const scoreW = Math.max(5, ...rows.map((r) => r.score.length));
  const lines = [
    `${pad("site", siteW)}  ${pad("email", emailW)}  ${pad("score", scoreW)}  reasons`,
    ...rows.map(
      (r) =>
        `${pad(r.site, siteW)}  ${pad(r.email, emailW)}  ${pad(r.score, scoreW)}  ${r.reasons}`,
    ),
  ];
  return lines.join("\n");
}

/**
 * `submissions <action>` — operate on stored form submissions. The only action today is
 * `rescore`: re-run the CURRENT spam classifier over the status='new' backlog. Dry-run
 * by default; `--apply` writes. Only status='new' rows are ever touched.
 */
export async function runSubmissionsCommand(
  action: string,
  opts: SubmissionsCommandOptions,
): Promise<{ output: string; code: number }> {
  if (action !== "rescore") {
    return { output: `unknown submissions action '${action}'. Use: rescore.`, code: 1 };
  }
  if (opts.apply && opts.dryRun) {
    return { output: "--apply and --dry-run conflict. Pick one.", code: 2 };
  }
  const apply = opts.apply === true;

  const { openDb, readDbConfig } = await import("../../db/client.js");
  const { SPAM_THRESHOLD } = await import("../../forms/spam-classifier.js");
  const cfg = opts.url ? { url: opts.url } : readDbConfig();
  const db = await openDb(cfg);

  const { scanned, flagged } = await rescoreNewSubmissions(db, { apply });
  if (flagged.length === 0) {
    return {
      output: `Scanned ${scanned} status='new' submission${scanned === 1 ? "" : "s"} — none score >= ${SPAM_THRESHOLD} under the current classifier. Nothing to re-bucket.`,
      code: 0,
    };
  }

  // Airtable is only consulted when there is a table to print.
  const table = formatTable(flagged, await loadSiteNames());
  const head = `Scanned ${scanned} status='new' submissions; ${flagged.length} score >= ${SPAM_THRESHOLD} under the current classifier:`;
  if (!apply) {
    return {
      output: `${head}\n\n${table}\n\nDRY RUN — nothing was written. Re-run with --apply to re-bucket these ${flagged.length} rows to spam_auto.`,
      code: 0,
    };
  }
  const written = flagged.filter((f) => f.written).length;
  const skipped = flagged.length - written;
  const skippedNote =
    skipped > 0
      ? `\n${skipped} row${skipped === 1 ? "" : "s"} skipped — no longer status='new' at write time (operator/ingest got there first).`
      : "";
  return {
    output: `${head}\n\n${table}\n\nApplied: ${written} row${written === 1 ? "" : "s"} → spam_auto (new score + reasons written, '${RESCORE_REASON_MARKER}' marker appended).${skippedNote}`,
    code: 0,
  };
}

// src/reports/digest.ts
import { openBase, readAirtableConfig, type AirtableBase } from "./airtable/client.js";
import { listAllReports, isPendingApproval } from "./airtable/reports.js";
import type { ReportRow } from "./airtable/reports.js";
import { listWebsites, siteSlug, type WebsiteRow } from "./airtable/websites.js";
import { defaultResendClient, type ResendClient } from "./send/resend.js";
import { isIdempotencyConflict } from "./send/idempotency.js";
import {
  collectVulnAlerts,
  collectDeliveryFailures,
  collectPreflightBlocked,
  collectLighthouseAlerts,
  collectRenovateAlerts,
  collectCiAlerts,
  collectAnalyticsFailures,
  collectTurnstileGuardrailAlerts,
  collectNotifyBounceAlerts,
  NOTIFY_BOUNCE_WINDOW_DAYS,
} from "../alerts/digest-collectors.js";
import { diffAttention, readDigestState, writeDigestState } from "../alerts/digest-state.js";
import { escapeHtml as esc } from "../util/html.js";
import type {
  AttentionItem,
  AttentionSeverity,
  AttentionStatus,
  ReadyItem,
  DigestSections,
  SubmissionsDigestSection,
} from "../alerts/attention.js";
// Type-only: erased at compile time, so the kysely/libsql devDependency never loads
// in a consuming fleet site (the runtime read is the dynamic import in
// fetchSubmissionsDigestCounts, same rule as fetchNotifyBounceCounts).
import type { SiteSubmissionCounts } from "../db/submissions.js";

// The attention/digest contract lives in `../alerts/attention.ts` (a dependency-free
// types module) so the `alerts/*` collectors can depend on it without importing back
// from this renderer/IO module — see attention.ts for the cycle it breaks. Re-exported
// here so existing `from "./digest.js"` type importers keep resolving.
export type {
  AttentionItem,
  AttentionSeverity,
  AttentionStatus,
  ReadyItem,
  DigestSections,
  SubmissionsDigestSection,
} from "../alerts/attention.js";

const GREY = "#757575";
const RED = "#C00";

/** Shared anchor style — Gmail does not inherit font-family into <a> tags. */
const ANCHOR_STYLE = `color:${RED};font-family:helvetica,sans-serif`;

function readySection(items: ReadyItem[]): string {
  const heading = `<h2 style="color:${RED};font-family:helvetica,sans-serif;font-size:20px;font-weight:700;margin:32px 0 8px">Ready for your yes</h2>`;
  if (items.length === 0) {
    return `${heading}<p style="color:${GREY};font-family:helvetica,sans-serif;font-size:16px;margin:0">Nothing waiting on you.</p>`;
  }
  const rows = items
    .map((it) => {
      const safeUrl = it.dashboardUrl.startsWith("https://") ? it.dashboardUrl : undefined;
      const link = safeUrl
        ? `<a href="${esc(safeUrl)}" style="${ANCHOR_STYLE}">review &amp; approve</a>`
        : `review &amp; approve`;
      return `
      <tr>
        <td style="color:${GREY};font-family:helvetica,sans-serif;font-size:16px;line-height:24px;padding-bottom:8px">
          <strong style="color:#222">${esc(it.siteName)}</strong> — ${esc(it.reportType)} (${esc(it.period)})
          — ${link}
        </td>
      </tr>`;
    })
    .join("");
  return `${heading}<table role="presentation" style="border-collapse:collapse;margin:0">${rows}</table>`;
}

const SEVERITY_ORDER: Record<AttentionSeverity, number> = { critical: 0, warning: 1 };

/** Render the per-item status badge ("NEW"/"WORSE"); standing items get nothing. */
function attentionBadge(status?: AttentionStatus): string {
  if (status === "new")
    return `<strong style="color:${RED};font-family:helvetica,sans-serif">NEW</strong> `;
  if (status === "worse")
    return `<strong style="color:${RED};font-family:helvetica,sans-serif">WORSE</strong> `;
  return "";
}

function attentionSection(items: AttentionItem[]): string {
  const heading = `<h2 style="color:${RED};font-family:helvetica,sans-serif;font-size:20px;font-weight:700;margin:32px 0 8px">Needs attention</h2>`;
  if (items.length === 0) {
    return `${heading}<p style="color:${GREY};font-family:helvetica,sans-serif;font-size:16px;margin:0">All clear — nothing needs attention.</p>`;
  }

  // Group by siteName, preserving first-seen site order; sort within a site by
  // severity (critical first).
  const bySite = new Map<string, AttentionItem[]>();
  for (const it of items) {
    const bucket = bySite.get(it.siteName);
    if (bucket) bucket.push(it);
    else bySite.set(it.siteName, [it]);
  }

  const groups = [...bySite.entries()]
    .map(([siteName, siteItems]) => {
      const sorted = [...siteItems].sort(
        (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
      );
      const rows = sorted
        .map((it) => {
          const safeUrl = it.url?.startsWith("https://") ? it.url : undefined;
          const titleHtml = safeUrl
            ? `<a href="${esc(safeUrl)}" style="${ANCHOR_STYLE}">${esc(it.title)}</a>`
            : esc(it.title);
          return `
          <tr>
            <td style="color:${GREY};font-family:helvetica,sans-serif;font-size:16px;line-height:24px;padding-bottom:8px">${attentionBadge(it.status)}${titleHtml}</td>
          </tr>`;
        })
        .join("");
      return `
      <tr>
        <td style="color:#222;font-family:helvetica,sans-serif;font-size:16px;font-weight:700;padding:8px 0 4px">${esc(siteName)}</td>
      </tr>
      ${rows}`;
    })
    .join("");

  return `${heading}<table role="presentation" style="border-collapse:collapse;margin:0">${groups}</table>`;
}

/** The "Submissions (24h)" telemetry block: fleet totals + a per-site glance line.
 *  Context, not an alarm — absent/null section or all-zero totals render nothing
 *  (no-noise), and the section never triggers a send on its own (see runDigest). */
function submissionsSection(s: SubmissionsDigestSection | null | undefined): string {
  if (!s) return "";
  if (s.leads === 0 && s.signups === 0 && s.spamAuto === 0) return "";
  const heading = `<h2 style="color:${RED};font-family:helvetica,sans-serif;font-size:20px;font-weight:700;margin:32px 0 8px">Submissions (24h)</h2>`;
  // All three terms always render together — omitting a zero term next to a nonzero
  // one reads as "not measured" rather than "none"; simplest honest form.
  const totals = [
    `${s.leads} new lead${s.leads === 1 ? "" : "s"}`,
    `${s.signups} newsletter/RSVP signup${s.signups === 1 ? "" : "s"}`,
    `${s.spamAuto} auto-filtered spam`,
  ].join(" · ");
  const totalLine = `<p style="color:${GREY};font-family:helvetica,sans-serif;font-size:16px;margin:0">${totals}</p>`;
  if (s.bySite.length === 0) return `${heading}${totalLine}`;
  const rows = s.bySite
    .map((site) => {
      const parts: string[] = [];
      if (site.leads > 0) parts.push(`${site.leads} lead${site.leads === 1 ? "" : "s"}`);
      if (site.signups > 0) parts.push(`${site.signups} signup${site.signups === 1 ? "" : "s"}`);
      if (site.spamAuto > 0) parts.push(`${site.spamAuto} auto-filtered`);
      return `
      <tr>
        <td style="color:${GREY};font-family:helvetica,sans-serif;font-size:16px;line-height:24px;padding-bottom:8px">
          <strong style="color:#222">${esc(site.siteName)}</strong> — ${parts.join(" · ")}
        </td>
      </tr>`;
    })
    .join("");
  return `${heading}${totalLine}<table role="presentation" style="border-collapse:collapse;margin:8px 0 0">${rows}</table>`;
}

const FROM_ADDRESS = "Reddoor Reports <reports@reddoorla.com>";
/** Single-operator fleet — fallback when OPERATOR_EMAIL is unset. */
const DIGEST_OPERATOR_FALLBACK = "info@reddoorla.com";

/** UTC "YYYY-MM-DD" — the Resend idempotency key suffix, so a same-day cron re-fire dedupes. */
function digestDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * The gate for "Ready for your yes": Draft ready ∧ ¬Approved to send ∧ Sent at BLANK.
 *
 * Implemented as `listAllReports(base).filter(...)` (the authorized deviation from the plan's
 * draft, which pre-dated Slice 1's merged fix): `listAllReports` already calls `mapRow`, which
 * handles `Period` correctly, so no local `rawToReportRow` duplicate is needed. The JS filter
 * does real work — the test fake does NOT evaluate `filterByFormula` — so correctness is
 * test-provable here.
 *
 * Exported: the fleet homepage (Task 3.5b) reuses it for the pending-approval count.
 */
export async function listPendingApproval(base: AirtableBase): Promise<ReportRow[]> {
  return (await listAllReports(base)).filter(isPendingApproval);
}

// ── collectAttention (IO wrapper, sibling to runDigest) ──────────────────────

export type CollectAttentionDeps = {
  base: AirtableBase;
  /** Same baseUrl value runDigest threads; used for the /s/<slug> links. */
  baseUrl: string;
  /** Pre-fetched Websites rows. When supplied (runDigest already read them),
   *  collectAttention reuses them instead of issuing a second `listWebsites`. */
  websites?: WebsiteRow[];
  /** Pre-fetched Reports rows. When supplied (runDigest already read them),
   *  collectAttention reuses them instead of issuing a second `listAllReports`. */
  reports?: ReportRow[];
  /** Clock for the GitHub-signals staleness gate (collectCiAlerts /
   *  collectRenovateAlerts skip a >3-day-stale sweep). Defaults to wall-clock;
   *  runDigest threads its run-start `today` so a quiet repo's frozen CI/Renovate
   *  signal stops badging once its sweep goes stale. */
  now?: Date;
  /** Pre-fetched per-site bounced-lead-notification counts (tests, or a caller with
   *  an open db). When omitted, collectAttention reads them from libSQL itself —
   *  defensively, so a missing TURSO env or a Turso blip drops just this signal. */
  notifyBounces?: ReadonlyMap<string, number>;
};

/** Per-site bounced-notification counts for the notify-bounce collector, read from
 *  libSQL over the collector's own window. The db modules are imported DYNAMICALLY:
 *  src/db/submissions.ts pulls kysely at top level, and kysely/libsql live in
 *  devDependencies consuming fleet sites don't install — a static import here would
 *  crash their CLI at require time (same rule as openDb's own lazy loads). Any
 *  failure (no TURSO env, Turso down) logs and yields an empty map: the digest
 *  must never blank over a missing optional signal. */
async function fetchNotifyBounceCounts(now: Date): Promise<ReadonlyMap<string, number>> {
  try {
    const [{ openDb, readDbConfig }, { countNotifyBouncedBySite }, { screenOutsSince }] =
      await Promise.all([
        import("../db/client.js"),
        import("../db/submissions.js"),
        import("../db/screenouts.js"),
      ]);
    const db = await openDb(readDbConfig());
    return await countNotifyBouncedBySite(db, screenOutsSince(now, NOTIFY_BOUNCE_WINDOW_DAYS));
  } catch (e) {
    console.warn(`⚠ notify-bounce counts unavailable (libSQL): ${(e as Error).message}`);
    return new Map();
  }
}

/** The "Submissions (24h)" telemetry window — a precise 24h ISO-timestamp compare
 *  (unlike screenOutsSince's date-only strings). */
const SUBMISSIONS_DIGEST_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Per-site submission counts for the digest telemetry section, read from libSQL.
 *  Dynamic imports + fail-soft for the same reason as fetchNotifyBounceCounts:
 *  kysely/libsql are devDependencies consuming fleet sites don't install, and a
 *  Turso blip must drop just this section, never the digest. Returns null (not an
 *  empty map) on failure so the renderer can omit the section rather than claim a
 *  quiet fleet. */
async function fetchSubmissionsDigestCounts(
  now: Date,
): Promise<ReadonlyMap<string, SiteSubmissionCounts> | null> {
  try {
    const [{ openDb, readDbConfig }, { countSubmissionsSinceBySite }] = await Promise.all([
      import("../db/client.js"),
      import("../db/submissions.js"),
    ]);
    const db = await openDb(readDbConfig());
    return await countSubmissionsSinceBySite(
      db,
      new Date(now.getTime() - SUBMISSIONS_DIGEST_WINDOW_MS).toISOString(),
    );
  } catch (e) {
    console.warn(`⚠ submissions telemetry unavailable (libSQL): ${(e as Error).message}`);
    return null;
  }
}

/** Assemble the "Submissions (24h)" section from the per-site counts. PURE (exported
 *  for direct tests). Totals sum ALL map entries — an orphan site id still counts in
 *  the fleet totals. bySite lists only ids that resolve in `sitesById` AND carry any
 *  nonzero count, sorted by total volume desc then siteName A-Z. null counts (libSQL
 *  unavailable) → null (section omitted). */
export function buildSubmissionsDigestSection(
  counts: ReadonlyMap<string, SiteSubmissionCounts> | null,
  sitesById: ReadonlyMap<string, WebsiteRow>,
): SubmissionsDigestSection | null {
  if (counts === null) return null;
  let leads = 0;
  let signups = 0;
  let spamAuto = 0;
  const bySite: SubmissionsDigestSection["bySite"] = [];
  for (const [siteId, c] of counts) {
    leads += c.leads;
    signups += c.signups;
    spamAuto += c.spamAuto;
    const site = sitesById.get(siteId);
    if (site && c.leads + c.signups + c.spamAuto > 0) {
      bySite.push({ siteName: site.name, ...c });
    }
  }
  bySite.sort(
    (a, b) =>
      b.leads + b.signups + b.spamAuto - (a.leads + a.signups + a.spamAuto) ||
      a.siteName.localeCompare(b.siteName),
  );
  return { leads, signups, spamAuto, bySite };
}

/** Run a single collector under a try/catch: a thrown collector logs and yields []
 *  so one broken signal never blanks the whole "Needs attention" section. */
function runCollector(label: string, fn: () => AttentionItem[]): AttentionItem[] {
  try {
    return fn();
  } catch (e) {
    console.warn(`⚠ attention collector "${label}" failed: ${(e as Error).message}`);
    return [];
  }
}

/**
 * Fetch the free signals once (listAllReports + listWebsites) — or reuse the
 * `reports`/`websites` arrays runDigest already read, so a single run reads each
 * table once — build the sitesById map the delivery collector needs, and run each
 * pure collector isolated. Returns the union of items; diffing/badging happens in
 * runDigest.
 *
 * The Renovate + CI signals come from the SAME persisted collectors the operator
 * cockpit (`buildCockpitModel`) runs — `collectRenovateAlerts` (key
 * `renovate:<siteId>`) and `collectCiAlerts` (key `ci:<siteId>`), reading the
 * nightly-persisted `renovateFailingCis`/`defaultBranchCi` fields. This is the
 * key-space unification: because the digest writes the shared Digest State
 * snapshot with these same keys, the cockpit's NEW/WORSE diff finds them and the
 * two surfaces agree (the prior live per-PR `renovate:<repo>#<n>` sweep never
 * matched the cockpit's keys, so its cards badged NEW forever).
 */
export async function collectAttention(deps: CollectAttentionDeps): Promise<AttentionItem[]> {
  const reports = deps.reports ?? (await listAllReports(deps.base));
  const websites = deps.websites ?? (await listWebsites(deps.base));
  const now = deps.now ?? new Date();
  const notifyBounces = deps.notifyBounces ?? (await fetchNotifyBounceCounts(now));
  const sitesById = new Map<string, WebsiteRow>(websites.map((w) => [w.id, w]));
  return [
    ...runCollector("vuln", () => collectVulnAlerts(websites, deps.baseUrl)),
    ...runCollector("delivery", () => collectDeliveryFailures(reports, sitesById, deps.baseUrl)),
    ...runCollector("preflight", () => collectPreflightBlocked(reports, sitesById, deps.baseUrl)),
    ...runCollector("lighthouse", () => collectLighthouseAlerts(websites, deps.baseUrl)),
    ...runCollector("renovate", () => collectRenovateAlerts(websites, deps.baseUrl, now)),
    ...runCollector("ci", () => collectCiAlerts(websites, deps.baseUrl, now)),
    ...runCollector("analytics", () => collectAnalyticsFailures(websites, deps.baseUrl, now)),
    ...runCollector("turnstile", () =>
      collectTurnstileGuardrailAlerts(websites, deps.baseUrl, now),
    ),
    ...runCollector("notify-bounce", () =>
      collectNotifyBounceAlerts(websites, notifyBounces, deps.baseUrl),
    ),
  ];
}

export type DigestRunOptions = {
  resend?: ResendClient;
  /** Dashboard origin for the /s/<slug> links, e.g. "https://reddoor-maintenance.netlify.app". */
  baseUrl: string;
  /**
   * Inject a pre-opened Airtable base (tests, server handlers).
   * When omitted, `openBase(readAirtableConfig())` is called from the environment.
   */
  base?: AirtableBase;
  /** Per-site submission counts for the "Submissions (24h)" section. undefined =
   *  fetch from libSQL; null = simulate unavailable (section omitted); a Map =
   *  injected (tests). */
  submissionCounts?: ReadonlyMap<string, SiteSubmissionCounts> | null;
};

export async function runDigest(
  options: DigestRunOptions,
): Promise<{ output: string; code: number }> {
  // Capture clock BEFORE any await so the idempotency key can't roll past midnight mid-run.
  const today = new Date();
  try {
    const base = options.base ?? openBase(readAirtableConfig());
    // Read each table ONCE for the whole run, then thread the arrays into
    // collectAttention so it doesn't re-fetch (was: listWebsites ×2, listAllReports
    // ×2). Pending is derived in-line with listPendingApproval's exact predicate.
    const reports = await listAllReports(base);
    const websites = await listWebsites(base);
    const sites = new Map(websites.map((w) => [w.id, w]));

    const pending = reports.filter(isPendingApproval);

    const readyForYourYes: ReadyItem[] = [];
    const baseUrl = options.baseUrl.replace(/\/$/, "");
    for (const r of pending) {
      const site = sites.get(r.siteId);
      if (!site) continue; // orphan report → skip rather than render a broken link
      // An empty Name slugs to "" → `/s/` is a dead link (getWebsiteBySlug can't
      // match it). Fall back to the fleet homepage so the operator still lands
      // somewhere usable instead of a 404.
      const slug = siteSlug(site.name);
      readyForYourYes.push({
        siteName: site.name,
        reportType: r.reportType,
        period: r.period ?? "—",
        dashboardUrl: slug ? `${baseUrl}/s/${slug}` : baseUrl,
      });
    }

    // M5: collect the free signals (isolated), diff against yesterday's snapshot.
    // Renovate + CI come from the persisted collectors (the same ones the cockpit
    // runs), so the snapshot this digest writes carries the `renovate:<siteId>` /
    // `ci:<siteId>` keys the cockpit diffs against — no live GitHub sweep here.
    const collected = await collectAttention({
      base,
      baseUrl: options.baseUrl,
      websites,
      reports,
      now: today,
    });
    const prior = await readDigestState(base);
    const { tagged, next } = diffAttention(collected, prior, digestDateKey(today));
    const needsAttention = tagged;

    // No-noise default: skip entirely when there's nothing to report.
    if (readyForYourYes.length === 0 && needsAttention.length === 0) {
      // On a skip, `collected` is [] so `next` is {} — still persist it so a key that
      // resolved on a quiet day clears and a later recurrence diffs as NEW (spec §10).
      // Wrapped: a write failure can't fail the skip.
      try {
        await writeDigestState(base, next);
      } catch (e) {
        console.warn(`⚠ digest state write failed: ${(e as Error).message}`);
      }
      return { output: "Digest skipped (nothing ready, nothing needs attention).", code: 0 };
    }

    // Submissions telemetry rides only on a digest that is ALREADY sending — the
    // skip predicate above is deliberately unchanged (leads already fire their own
    // ingest-time notification; this is context, not an alarm), and fetching AFTER
    // the skip check keeps quiet days from touching libSQL at all.
    const counts =
      options.submissionCounts !== undefined
        ? options.submissionCounts
        : await fetchSubmissionsDigestCounts(today);
    const submissions = buildSubmissionsDigestSection(counts, sites);

    const html = renderDigestHtml({ readyForYourYes, needsAttention, submissions });
    const client = options.resend ?? defaultResendClient();
    const to = [process.env.OPERATOR_EMAIL?.trim() || DIGEST_OPERATOR_FALLBACK];
    const n = readyForYourYes.length;
    const reportWord = n === 1 ? "report" : "reports";
    let result: Awaited<ReturnType<typeof client.send>>;
    try {
      result = await client.send({
        from: FROM_ADDRESS,
        to,
        subject: `Your fleet — ${digestDateKey(today)}: ${n} ${reportWord} ready for your yes`,
        html,
        idempotencyKey: `digest-${digestDateKey(today)}`,
      });
    } catch (err) {
      // A same-UTC-day re-run whose content changed re-sends with the same
      // `digest-<date>` idempotency key but a DIFFERENT body. Resend rejects that
      // with a 409 (`invalid_idempotent_request`) — "This idempotency key has been
      // used ... but the request body was modified ...". The operator already got
      // today's digest on the first send, so re-sending a changed version same-day
      // would just be a duplicate: treat it as an "already sent today" no-op.
      //
      // ResendClient (send/resend.ts) wraps the API error as a plain Error and only
      // preserves the *message* string (no name/statusCode), so the message
      // substring is the only reliable discriminator — match defensively on it.
      // Any OTHER send error re-throws to the outer catch → {code:1}, so a genuine
      // Resend/network failure still fails loudly.
      if (isIdempotencyConflict(err)) {
        // Do NOT write the snapshot: the first send already persisted it; writing
        // this run's `next` would diff against the first run's snapshot and mis-badge.
        return {
          output:
            "Digest already sent today (content changed since the first send) — skipped to avoid a duplicate.",
          code: 0,
        };
      }
      throw err;
    }
    // Persist the next snapshot AFTER a successful send. A write failure is caught +
    // logged: the digest already went out, tomorrow re-news at worst. (The send-FAILURE
    // path never reaches here — the outer catch returns code 1 with no write, preserving
    // the NEW badge for the retry.)
    try {
      await writeDigestState(base, next);
    } catch (e) {
      console.warn(`⚠ digest state write failed: ${(e as Error).message}`);
    }
    return { output: `Digest sent to ${to.join(", ")} (${result.messageId})`, code: 0 };
  } catch (err) {
    // Re-throw config errors (exitCode=2: missing env vars, bad config) so runOrExit
    // surfaces them with the correct process exit code rather than collapsing to 1.
    if (typeof (err as { exitCode?: unknown }).exitCode === "number") {
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    return { output: `digest failed: ${message}`, code: 1 };
  }
}

/** Pure render of the unified daily operator digest. No IO — the caller (runDigest)
 *  collects the rows and decides whether to send. */
export function renderDigestHtml(sections: DigestSections): string {
  return `<!doctype html>
<html>
  <head><meta charset="utf-8"></head>
  <body style="margin:0;padding:0;background:#ffffff">
    <table width="100%" style="border-collapse:collapse">
      <tr>
        <td align="center" style="padding:24px">
          <table width="600" style="border-collapse:collapse">
            <tr>
              <td>
                <h1 style="color:${RED};font-family:helvetica,sans-serif;font-size:24px;font-weight:700;margin:0 0 8px">Your fleet today</h1>
                ${readySection(sections.readyForYourYes)}
                ${attentionSection(sections.needsAttention)}
                ${submissionsSection(sections.submissions)}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

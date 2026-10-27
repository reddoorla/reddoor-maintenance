// src/reports/digest.ts
import { isPendingApproval, type ReportRow } from "./report-row.js";
import type { NotifyBounceCounts } from "../db/submissions.js";
import { isDashboardVisible, siteSlug, type WebsiteRow } from "../fleet/site-row.js";
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
  collectDeadLetterAlerts,
  collectPrismicDriftAlerts,
  collectUrlResolveAlerts,
  collectDeployAlerts,
  NOTIFY_BOUNCE_WINDOW_DAYS,
} from "../alerts/digest-collectors.js";
import {
  collectA11yAlerts,
  collectDepsAlerts,
  collectDomainAlerts,
  collectFunctionHealthAlerts,
  collectLinkAlerts,
  collectRenderAlerts,
  collectTitleMetaAlerts,
  collectUptimeAlerts,
  type LatestDeps,
} from "../alerts/production-signals.js";
import { markWaiting } from "../alerts/waiting.js";
import { LEVEL_RANK, levelOf, withLevels, type Level } from "../alerts/ladder.js";
import { diffAttention, type DigestSnapshot } from "../alerts/digest-state.js";
import {
  ageLabel,
  daysBetween,
  decideDigestSend,
  digestChanges,
  nextSent,
  LIGHTHOUSE_WORSE_POINTS,
  type DigestLine,
  nextReadySince,
  EMPTY_SEND_LOG,
  DIGEST_HEARTBEAT_DAYS,
  type DigestSendLog,
  type DigestChanges,
} from "../alerts/digest-send.js";
import { escapeHtml as esc } from "../util/html.js";
import { operatorEmail } from "../util/operator.js";
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
import { TRIAGE_PATH } from "../dashboard/home-path.js";

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
      const age = ageLabel(it.ageDays);
      const ageHtml = age ? ` <span style="color:${GREY}">(waiting ${esc(age)})</span>` : "";
      return `
      <tr>
        <td style="color:${GREY};font-family:helvetica,sans-serif;font-size:16px;line-height:24px;padding-bottom:8px">
          <strong style="color:#222">${esc(it.siteName)}</strong> — ${esc(it.reportType)} (${esc(it.period)})
          — ${link}${ageHtml}
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

/** An item's level: the one `withLevels` set, or its level with no date. */
function levelOfItem(it: AttentionItem): Level {
  return it.level ?? levelOf(it, undefined, new Date(0));
}

/** P1-78d: worst level first (Broken, then Attention), then by severity; one site's
 *  items stay together, and a site sorts by its worst item. */
function rankOf(it: AttentionItem): number {
  return LEVEL_RANK[levelOfItem(it)] * 10 + SEVERITY_ORDER[it.severity];
}

export function orderAttention(items: readonly AttentionItem[]): AttentionItem[] {
  const rank = rankOf;
  const bySite = new Map<string, AttentionItem[]>();
  for (const it of items) {
    const bucket = bySite.get(it.siteName);
    if (bucket) bucket.push(it);
    else bySite.set(it.siteName, [it]);
  }
  // Stable sorts: on a tie a site keeps its place, and an item its place in its site.
  return [...bySite.values()]
    .map((siteItems) => [...siteItems].sort((a, b) => rank(a) - rank(b)))
    .sort((a, b) => rank(a[0]!) - rank(b[0]!))
    .flat();
}

/** P1-78d: Broken, then Attention, each its own section. Watch never reaches the
 *  email (runDigest drops it after the diff). Nothing in either: one all-clear. */
function attentionSection(items: AttentionItem[]): string {
  if (items.length === 0) {
    const heading = `<h2 style="color:${RED};font-family:helvetica,sans-serif;font-size:20px;font-weight:700;margin:32px 0 8px">Needs attention</h2>`;
    return `${heading}<p style="color:${GREY};font-family:helvetica,sans-serif;font-size:16px;margin:0">All clear — nothing needs attention.</p>`;
  }
  const at = (l: Level) => items.filter((it) => levelOfItem(it) === l);
  return [
    levelSection("Broken — someone outside Reddoor is affected now", at("broken")),
    levelSection("Attention — fix this week", at("attention")),
  ].join("");
}

function levelSection(title: string, items: AttentionItem[]): string {
  if (items.length === 0) return "";
  const heading = `<h2 style="color:${RED};font-family:helvetica,sans-serif;font-size:20px;font-weight:700;margin:32px 0 8px">${esc(title)}</h2>`;

  const bySite = new Map<string, AttentionItem[]>();
  for (const it of orderAttention(items)) {
    const bucket = bySite.get(it.siteName);
    if (bucket) bucket.push(it);
    else bySite.set(it.siteName, [it]);
  }

  const groups = [...bySite.entries()]
    .map(([siteName, siteItems]) => {
      const rows = siteItems
        .map((it) => {
          const safeUrl = it.url?.startsWith("https://") ? it.url : undefined;
          const titleHtml = safeUrl
            ? `<a href="${esc(safeUrl)}" style="${ANCHOR_STYLE}">${esc(it.title)}</a>`
            : esc(it.title);
          const age = ageLabel(it.ageDays);
          const ageHtml = age ? ` <span style="color:${GREY}">(${esc(age)})</span>` : "";
          const askHtml = it.ask ? `<br><span style="color:#222">→ ${esc(it.ask)}</span>` : "";
          return `
          <tr>
            <td style="color:${GREY};font-family:helvetica,sans-serif;font-size:16px;line-height:24px;padding-bottom:8px">${attentionBadge(it.status)}${titleHtml}${ageHtml}${askHtml}</td>
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

function touchedBy(it: AttentionItem, keys: readonly string[]): boolean {
  return keys.some((k) => k === it.key || k.startsWith(`${it.key}#`));
}

export const DIGEST_SUBJECT_SUFFIX_MAX = 150;

function clipSuffix(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= DIGEST_SUBJECT_SUFFIX_MAX
    ? flat
    : `${flat
        .slice(0, DIGEST_SUBJECT_SUFFIX_MAX - 1)
        .replace(/[\uD800-\uDBFF]$/, "")
        .trimEnd()}…`;
}

export function digestSubject(input: {
  date: string;
  readyForYourYes: readonly ReadyItem[];
  needsAttention: readonly AttentionItem[];
  changes: DigestChanges;
  lastSentOn: string | null;
}): string {
  return `Your fleet — ${input.date}: ${clipSuffix(digestSubjectSuffix(input))}`;
}

function digestSubjectSuffix(input: Parameters<typeof digestSubject>[0]): string {
  // P1-78d: only a Broken or Attention item is ever named; Watch is never news.
  const ordered = orderAttention(input.needsAttention.filter((it) => levelOfItem(it) !== "watch"));
  const changed = [...input.changes.added, ...input.changes.worse];
  // A changed Broken item is always an "Act:" (someone outside Reddoor is affected now), and
  // it is named ahead of a critical Attention item (P1-78d review round 3). The candidates are
  // ranked on their own: `ordered` keeps a site's items together, so a site whose worst item
  // is an unchanged Broken one would put its Attention item first (review round 4).
  const critical = ordered
    .filter(
      (it) =>
        (it.severity === "critical" || levelOfItem(it) === "broken") && touchedBy(it, changed),
    )
    .sort((a, b) => rankOf(a) - rankOf(b));
  if (critical.length > 0) {
    const first = critical[0]!;
    const ask = first.ask ? `: ${first.ask}` : "";
    const more = critical.length > 1 ? ` (+${critical.length - 1} more)` : "";
    return `Act: ${first.siteName} — ${first.title}${ask}${more}`;
  }
  const n = input.readyForYourYes.length;
  if (n > 0) {
    const oldest = Math.max(...input.readyForYourYes.map((r) => r.ageDays ?? 0));
    const age = ageLabel(oldest);
    return `${n} ${n === 1 ? "report" : "reports"} ready for your yes${age ? ` — oldest ${age}` : ""}`;
  }
  const added = ordered.filter((it) => touchedBy(it, input.changes.added));
  if (added.length > 0) return `${added.length} new — ${added[0]!.title}`;
  const worse = ordered.filter((it) => touchedBy(it, input.changes.worse));
  if (worse.length > 0) return `${worse.length} worse — ${worse[0]!.title}`;
  return input.lastSentOn ? `no change since ${input.lastSentOn}` : "first digest";
}

/** P1-78d: the badge says what is news in THIS email, against what the last mail
 *  carried (`changes`, from the send log). Only a standing item is re-badged: a badge
 *  the snapshot set (NEW after a gap, WORSE) stands. An unread log (none stored, or a
 *  failed read) says nothing about what was mailed, so every badge stands. A new ask
 *  under a key (`key#ask`) is news too, as the subject counts it (`touchedBy`). */
export function badgeFromSendLog(
  items: readonly AttentionItem[],
  changes: { added: readonly string[]; worse: readonly string[] },
  logRead: boolean,
): AttentionItem[] {
  return items.map((it): AttentionItem => {
    if (!logRead) return it;
    if (it.status !== "standing" && it.status !== undefined) return it;
    if (touchedBy(it, changes.added)) return { ...it, status: "new" };
    if (touchedBy(it, changes.worse)) return { ...it, status: "worse" };
    return it;
  });
}

/** UTC "YYYY-MM-DD" — the Resend idempotency key suffix, so a same-day cron re-fire dedupes. */
function digestDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ── collectAttention (IO wrapper, sibling to runDigest) ──────────────────────

export type CollectAttentionDeps = {
  /** Same baseUrl value runDigest threads; used for the /s/<slug> links. */
  baseUrl: string;
  /** The run's Websites rows. Read ONCE by runDigest — from Turso since #646
   *  step 4 — and threaded in; collectAttention never opens a store of its own
   *  for them. Required since that step: an optional array with a store-reading
   *  fallback is how a test silently reaches a live base. */
  websites: WebsiteRow[];
  /** The run's Reports rows, on the same contract as `websites`. */
  reports: ReportRow[];
  /** Clock for the GitHub-signals staleness gate (collectCiAlerts /
   *  collectRenovateAlerts skip a >3-day-stale sweep). Defaults to wall-clock;
   *  runDigest threads its run-start `today` so a quiet repo's frozen CI/Renovate
   *  signal stops badging once its sweep goes stale. */
  now?: Date;
  /** Pre-fetched per-site bounced-lead-notification counts (tests, or a caller with
   *  an open db). When omitted, collectAttention reads them from libSQL itself —
   *  defensively, so a missing TURSO env or a Turso blip drops just this signal. */
  notifyBounces?: ReadonlyMap<string, NotifyBounceCounts>;
  /** Pre-fetched unreplayed dead-letter counts per SLUG (#645). Same contract as
   *  `notifyBounces`: omitted → read from libSQL, defensively. */
  deadLetters?: ReadonlyMap<string, number>;
  /** OD 87: the oldest unreplayed row's received_at per slug, the clock of a known
   *  site's hold. Omitted with `deadLetters` → read from libSQL beside it; omitted
   *  while `deadLetters` is given → empty, and nothing is held. */
  deadLetterOldest?: ReadonlyMap<string, string>;
  /** P1-78c. The latest `fleet_daily` dependency readings, which date a package a
   *  major behind. Omitted or null → no dependency items. */
  fleetDeps?: LatestDeps | null;
};

/** Per-site bounced-notification counts for the notify-bounce collector, read from
 *  libSQL over the collector's own window. The db modules are imported DYNAMICALLY:
 *  src/db/submissions.ts pulls kysely at top level, and kysely/libsql live in
 *  devDependencies consuming fleet sites don't install — a static import here would
 *  crash their CLI at require time (same rule as openDb's own lazy loads). Any
 *  failure (no TURSO env, Turso down) logs and yields an empty map: the digest
 *  must never blank over a missing optional signal. */
async function fetchNotifyBounceCounts(
  now: Date,
): Promise<ReadonlyMap<string, NotifyBounceCounts>> {
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

/** Unreplayed dead-letter counts per slug for the #645 collector. Dynamically
 *  imported and defensive for exactly the same reasons as
 *  `fetchNotifyBounceCounts` above: kysely/libsql are devDependencies consuming
 *  fleet sites do not install, and the digest must never blank over a missing
 *  optional signal. */
async function fetchDeadLetterCounts(): Promise<{
  counts: ReadonlyMap<string, number>;
  oldest: ReadonlyMap<string, string>;
}> {
  let db;
  let deadletter;
  try {
    const [{ openDb, readDbConfig }, mod] = await Promise.all([
      import("../db/client.js"),
      import("../db/deadletter.js"),
    ]);
    deadletter = mod;
    db = await openDb(readDbConfig());
  } catch (e) {
    console.warn(`⚠ dead-letter counts unavailable (libSQL): ${(e as Error).message}`);
    return { counts: new Map(), oldest: new Map() };
  }
  let counts: ReadonlyMap<string, number>;
  try {
    counts = await deadletter.countUnreplayedDeadLettersBySlug(db);
  } catch (e) {
    console.warn(`⚠ dead-letter counts unavailable (libSQL): ${(e as Error).message}`);
    return { counts: new Map(), oldest: new Map() };
  }
  // OD 87: the hold's clock. A failed read holds nothing: every dead letter alarms.
  try {
    return { counts, oldest: await deadletter.oldestUnreplayedDeadLetterBySlug(db) };
  } catch (e) {
    console.warn(`⚠ dead-letter ages unavailable (libSQL): ${(e as Error).message}`);
    return { counts, oldest: new Map() };
  }
}

/** The prior snapshot, from Turso (#609). Dynamically imported for the same
 *  reason as fetchNotifyBounceCounts: kysely/libsql are devDependencies that
 *  consuming fleet sites do not install, so a static import would crash their
 *  CLI at require time.
 *
 *  NOT defensive, deliberately. Swallowing a failure here would silently badge every item NEW, which reads
 *  as "the whole fleet degraded overnight" in the operator's inbox. A thrown
 *  error is the honest outcome. */
async function readDigestStateFromDb(): Promise<DigestSnapshot> {
  const [{ openDb, readDbConfig }, { readDigestStateChecked }] = await Promise.all([
    import("../db/client.js"),
    import("../db/digest-state.js"),
  ]);
  const read = await readDigestStateChecked(await openDb(readDbConfig()));
  // #1613. A corrupt snapshot reads as `{}` by design (digest-state.ts), which
  // badges every item NEW. This line is what says why; the workflow warns on it.
  console.log(`DIGEST_STATE_READ snapshot=${read.state}`);
  return read.value;
}

/** Bridge the injectable seam (returns void) onto the three-state contract the
 *  log line reports. An injected writer that resolves is a real write. */
async function writeRollupOnce(
  options: DigestRunOptions,
  now: Date,
): Promise<"written" | "absent"> {
  if (options.cockpitRollup) {
    await options.cockpitRollup.write(now);
    return "written";
  }
  return writeCockpitRollupToDb(now);
}

async function readSendLogFromDb(): Promise<{ log: DigestSendLog; read: SendLogRead }> {
  const [{ openDb, readDbConfig }, { readDigestSendLogChecked }] = await Promise.all([
    import("../db/client.js"),
    import("../db/digest-state.js"),
  ]);
  const r = await readDigestSendLogChecked(await openDb(readDbConfig()));
  return { log: r.value, read: r.state };
}

async function writeSendLogToDb(log: DigestSendLog): Promise<void> {
  const [{ openDb, readDbConfig }, { writeDigestSendLog }] = await Promise.all([
    import("../db/client.js"),
    import("../db/digest-state.js"),
  ]);
  await writeDigestSendLog(await openDb(readDbConfig()), log);
}

/** #1613. How the send log read went, printed as `read=` on the
 *  DIGEST_SEND_LOG line. `corrupt` and `failed` both make this run read "never
 *  sent", so it re-sends as `first` (the nag the log exists to stop); the
 *  workflow reds on either. An injected reader (tests) reports `ok`. */
type SendLogRead = "ok" | "absent" | "corrupt" | "failed";

async function readSendLogSafely(
  options: DigestRunOptions,
): Promise<{ log: DigestSendLog; read: SendLogRead }> {
  try {
    if (options.sendLog) return { log: await options.sendLog.read(), read: "ok" };
    return await readSendLogFromDb();
  } catch (e) {
    console.warn(`⚠ digest send log unavailable, sending: ${(e as Error).message}`);
    return { log: EMPTY_SEND_LOG, read: "failed" };
  }
}

async function writeSendLogSafely(
  options: DigestRunOptions,
  log: DigestSendLog,
  decision: string,
  read: SendLogRead,
): Promise<void> {
  let ok = 0;
  try {
    await (options.sendLog?.write ?? writeSendLogToDb)(log);
    ok = 1;
  } catch (e) {
    console.warn(`⚠ digest send log write failed: ${(e as Error).message}`);
  }
  console.log(`DIGEST_SEND_LOG write=${ok} decision=${decision} read=${read}`);
}

/** The write half of {@link readDigestStateFromDb}, same lazy-import rule. */
async function writeDigestStateToDb(next: DigestSnapshot): Promise<void> {
  const [{ openDb, readDbConfig }, { writeDigestState }] = await Promise.all([
    import("../db/client.js"),
    import("../db/digest-state.js"),
  ]);
  await writeDigestState(await openDb(readDbConfig()), next);
}

/**
 * Compute the cockpit's "since a window" roll-ups once, here, instead of on
 * every page load (MED-16 of the 2026-08-26 review).
 *
 * Both aggregates read the whole `submissions` table — the one unbounded-growth
 * table in the schema — and the cockpit root is the operator's most-loaded page.
 * Turso meters row scans, so recomputing them per request is a cost that grows
 * forever against numbers that move once a day.
 *
 * The trade is explicit: the figures become up to 24h old. That is why the
 * payload carries `computedAt` and the windows it used, and why an absent
 * roll-up reads as null rather than zero — a stale or unmeasured number
 * presented as live is worse than no number.
 *
 * Best-effort, like the snapshot write beside it: the digest has already been
 * sent by the time this runs, and a failed roll-up costs one strip on one page
 * until tomorrow, never the digest.
 */
async function writeCockpitRollupToDb(now: Date): Promise<"written" | "absent"> {
  // No Turso configured is a THIRD state, not a failure: it is what every unit
  // test looks like, and reporting it as `rollup=0` would train the eye to
  // ignore the number that is supposed to catch a dead writer. Same three-state
  // vocabulary the site mirrors already use (`mirrored=1|0|absent`).
  if (!process.env.TURSO_DATABASE_URL) return "absent";
  const [{ openDb, readDbConfig }, { writeCockpitRollup }, screenouts, submissions, collectors] =
    await Promise.all([
      import("../db/client.js"),
      import("../db/digest-state.js"),
      import("../db/screenouts.js"),
      import("../db/submissions.js"),
      import("../alerts/digest-collectors.js"),
    ]);
  const db = await openDb(readDbConfig());
  const SCREEN_OUT_WINDOW_DAYS = 30;
  const screenOutSince = screenouts.screenOutsSince(now, SCREEN_OUT_WINDOW_DAYS);
  const bounceSince = screenouts.screenOutsSince(now, collectors.NOTIFY_BOUNCE_WINDOW_DAYS);

  const totals = { honeypot: 0, tooFast: 0, markedSpam: 0 };
  for (const t of (await screenouts.listScreenOutsSince(db, screenOutSince)).values()) {
    totals.honeypot += t.honeypot;
    totals.tooFast += t.tooFast;
    totals.markedSpam += t.markedSpam;
  }
  const bounces = await submissions.countNotifyBouncedBySite(db, bounceSince);

  await writeCockpitRollup(db, {
    spamTotals: totals,
    notifyBounces: Object.fromEntries(bounces),
    windowDays: {
      screenOuts: SCREEN_OUT_WINDOW_DAYS,
      bounces: collectors.NOTIFY_BOUNCE_WINDOW_DAYS,
    },
    computedAt: now.toISOString(),
  });
  return "written";
}

/** Persist the next snapshot to Turso, the side the next run reads (#609).
 *
 *  Best-effort: the digest has already been sent (or deliberately skipped) by
 *  the time this runs, and a snapshot write failure re-news at worst.
 *
 *  The DIGEST_STATE_WRITE line exists because of #585: a write that silently
 *  stopped running looked identical to a healthy one for weeks. One line,
 *  always emitted. */
async function persistDigestState(
  next: DigestSnapshot,
  writeState?: (snap: DigestSnapshot) => Promise<void>,
  writeRollup?: () => Promise<"written" | "absent">,
): Promise<void> {
  let turso = 0;
  let rollup: "1" | "0" | "absent" = "0";
  try {
    await (writeState ?? writeDigestStateToDb)(next);
    turso = 1;
  } catch (e) {
    console.warn(`⚠ digest state write failed (turso): ${(e as Error).message}`);
  }
  // The cockpit roll-up rides the same "already sent, best-effort" contract, and
  // gets its own counter on the line for the #585 reason: a dual-write that
  // silently stopped running looked identical to a healthy one for weeks. An
  // ABSENT `rollup=` is a different failure from `rollup=0`.
  if (writeRollup) {
    try {
      rollup = (await writeRollup()) === "absent" ? "absent" : "1";
    } catch (e) {
      rollup = "0";
      console.warn(`⚠ cockpit rollup write failed: ${(e as Error).message}`);
    }
  }
  console.log(`DIGEST_STATE_WRITE turso=${turso} rollup=${rollup}`);
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
 * Take the run's `reports`/`websites` (runDigest read them once, from Turso since
 * #646 step 4), build the sitesById map the delivery collector needs, and run each
 * pure collector isolated. Returns the union of items; diffing/badging happens in
 * runDigest. This function opens no store of its own for those two datasets.
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
  const { reports, websites } = deps;
  const now = deps.now ?? new Date();
  const notifyBounces = deps.notifyBounces ?? (await fetchNotifyBounceCounts(now));
  const fetched = deps.deadLetters === undefined ? await fetchDeadLetterCounts() : null;
  const deadLetters = deps.deadLetters ?? fetched!.counts;
  const deadLetterOldest = deps.deadLetterOldest ?? fetched?.oldest ?? new Map();
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
    // #645. The dead-letter alarm. The digest is the SURFACE that matters for
    // this kind: the cockpit groups items onto site cards, and the worst flavour
    // — a slug that resolves to no fleet site — has no card by construction. The
    // digest renders every item flat by title, so it carries both flavours.
    ...runCollector("deadletter", () =>
      // Visible rows last, so a visible site wins a slug its archived namesake's
      // name also gives (the cockpit's order: buildCockpitModel).
      collectDeadLetterAlerts(
        [...websites.filter((w) => !isDashboardVisible(w)), ...websites.filter(isDashboardVisible)],
        deadLetters,
        deps.baseUrl,
        deadLetterOldest,
      ),
    ),
    // Same collector the cockpit runs, over the same persisted `Prismic Models`
    // columns and the same keys — so the snapshot this digest writes is the one
    // the cockpit diffs NEW/WORSE against, and the two surfaces agree.
    ...runCollector("prismic-drift", () => collectPrismicDriftAlerts(websites, deps.baseUrl, now)),
    // #912. Digest-only: its scope is every non-archived row, and a `building`
    // site has no cockpit card to carry it.
    ...runCollector("url", () => collectUrlResolveAlerts(websites, deps.baseUrl, now)),
    // P1-78b, the one digest change the ladder makes: a maintained site's failed
    // production deploy is an item, so it is mailed and dated, and the snapshot gives
    // the triage row its age. Maintained only (collectDeployAlerts): a launching
    // site's failed deploy stays muted, as on the cockpit.
    ...runCollector("deploy", () => collectDeployAlerts(websites, deps.baseUrl)),
    // P1-78c. The Broken and Attention production signals, as on the cockpit, so
    // each is mailed and the snapshot ages it. The Watch ones (dependencies behind,
    // Search Console) are the cockpit's only: no age needed, no mail. The live form
    // test is built but not registered until its probe is fixed (fleet-cockpit.ts).
    ...runCollector("uptime", () => collectUptimeAlerts(websites, deps.baseUrl, now)),
    ...runCollector("domain", () => collectDomainAlerts(websites, deps.baseUrl, now)),
    ...runCollector("function-health", () =>
      collectFunctionHealthAlerts(websites, deps.baseUrl, now),
    ),
    ...runCollector("render", () => collectRenderAlerts(websites, deps.baseUrl, now)),
    ...runCollector("links", () => collectLinkAlerts(websites, deps.baseUrl, now)),
    ...runCollector("titles", () => collectTitleMetaAlerts(websites, deps.baseUrl, now)),
    ...runCollector("a11y", () => collectA11yAlerts(websites, deps.baseUrl, now)),
    ...runCollector(
      "deps",
      () => collectDepsAlerts(websites, deps.fleetDeps ?? null, deps.baseUrl, now).far,
    ),
  ];
}

export type DigestRunOptions = {
  resend?: ResendClient;
  /** Dashboard origin for the /s/<slug> links, e.g. "https://reddoor-maintenance.netlify.app". */
  baseUrl: string;
  /**
   * The run's two datasets. Since #646 step 4 they come from TURSO, read by the
   * command that calls this (one connection, both reads).
   *
   * Functions rather than arrays, and required rather than defaulted: a read
   * failure must still be able to red the run (it is caught below and reported as
   * `digest failed:`), and no caller — least of all a test — can reach a store
   * this did not hand it.
   */
  roster: () => Promise<WebsiteRow[]>;
  allReports: () => Promise<ReportRow[]>;
  /** Per-site submission counts for the "Submissions (24h)" section. undefined =
   *  fetch from libSQL; null = simulate unavailable (section omitted); a Map =
   *  injected (tests). */
  submissionCounts?: ReadonlyMap<string, SiteSubmissionCounts> | null;
  /**
   * The prior-run snapshot store (#609). Production omits it and gets Turso.
   *
   * Injectable because the read is deliberately NOT defensive: swallowing a
   * failure would badge every item NEW, which lands in the operator's inbox
   * reading as "the whole fleet degraded overnight". That makes Turso a hard
   * requirement of a real run — so tests, which have no libSQL, need a seam
   * rather than an env var.
   */
  digestState?: {
    read: () => Promise<DigestSnapshot>;
    write: (snap: DigestSnapshot) => Promise<void>;
  };
  /**
   * The cockpit roll-up writer (MED-16). Same seam and same reason as
   * `digestState`: production omits it and gets Turso, tests inject.
   *
   * Without a seam this would be untestable in exactly the way that matters —
   * `writeCockpitRollupToDb` opens a db from env, so in a test it throws and is
   * caught, and the run reports `rollup=0` forever while looking healthy. That
   * is the #585 shape the counter on the log line exists to expose.
   */
  cockpitRollup?: { write: (now: Date) => Promise<void> };
  sendLog?: {
    read: () => Promise<DigestSendLog>;
    write: (log: DigestSendLog) => Promise<void>;
  };
  /**
   * The run clock. Production omits it and gets `new Date()`.
   *
   * Injectable because several collectors this run feeds are AGE-SENSITIVE —
   * `collectPrismicDriftAlerts` alone changes an item's key and its wording once
   * a verdict crosses `PRISMIC_DRIFT_STALE_DAYS` — so a digest test that cannot
   * fix the clock is asserting on the day it happens to run. Two did, and both
   * went red four days after they were written, reporting the staleness wording
   * as if the drift wiring had broken. `collectAttention` already takes a `now`
   * for exactly this reason; this threads the same lever one layer out.
   */
  now?: Date;
  /** P1-78c. The latest `fleet_daily` dependency readings; production reads Turso
   *  (report.ts). Optional and defensive: a failed read drops the dependency items. */
  latestDeps?: () => Promise<LatestDeps | null>;
};

/** The dependency readings, or null: a failed read drops one signal, never the digest. */
async function readLatestDepsSafely(options: DigestRunOptions): Promise<LatestDeps | null> {
  if (!options.latestDeps) return null;
  try {
    return await options.latestDeps();
  } catch (e) {
    console.warn(`⚠ fleet_daily dependency readings unavailable: ${(e as Error).message}`);
    return null;
  }
}

export async function runDigest(
  options: DigestRunOptions,
): Promise<{ output: string; code: number }> {
  // Capture clock BEFORE any await so the idempotency key can't roll past midnight mid-run.
  const today = options.now ?? new Date();
  try {
    // Read each dataset ONCE for the whole run, then thread the arrays into
    // collectAttention so it doesn't re-fetch. Pending is derived in-line with
    // isPendingApproval.
    const reports = await options.allReports();
    const websites = await options.roster();
    const sites = new Map(websites.map((w) => [w.id, w]));

    const pending = reports.filter(isPendingApproval);

    const readyForYourYes: ReadyItem[] = [];
    const readyKeys: string[] = [];
    const baseUrl = options.baseUrl.replace(/\/$/, "");
    for (const r of pending) {
      const site = sites.get(r.siteId);
      if (!site) continue; // orphan report → skip rather than render a broken link
      // An empty Name slugs to "" → `/s/` is a dead link (the site route can't
      // match it). Fall back to the fleet homepage so the operator still lands
      // somewhere usable instead of a 404.
      const slug = siteSlug(site.name);
      readyKeys.push(`ready:${r.id}`);
      readyForYourYes.push({
        siteName: site.name,
        reportType: r.reportType,
        period: r.period ?? "—",
        dashboardUrl: slug ? `${baseUrl}/s/${slug}` : `${baseUrl}${TRIAGE_PATH}`,
      });
    }

    // M5: collect the free signals (isolated), diff against yesterday's snapshot.
    // Renovate + CI come from the persisted collectors (the same ones the cockpit
    // runs), so the snapshot this digest writes carries the `renovate:<siteId>` /
    // `ci:<siteId>` keys the cockpit diffs against — no live GitHub sweep here.
    const collected = await collectAttention({
      baseUrl: options.baseUrl,
      websites,
      reports,
      now: today,
      fleetDeps: await readLatestDepsSafely(options),
    });
    // #609: the prior snapshot is Turso's digest_state row.
    const prior = await (options.digestState?.read ?? readDigestStateFromDb)();
    const dayKey = digestDateKey(today);
    const diffed = diffAttention(collected, prior, dayKey);
    const next = diffed.next;
    // The operator hears about an item only once waiting on its own fix has failed
    // (markWaiting: a vuln Renovate exhausted, or one that outlived its lock-file
    // window or its direct-fix week). Before that the fleet is still fixing it and
    // only the site page shows it. Filter the EMAIL list only: `next` (written below)
    // must keep every waiting key so its `firstFlaggedAt` keeps counting, and so the
    // exhausted-flip diffs as WORSE instead of arriving pre-badged-away.
    // P1-78d: the ladder. Watch items stay in `next` (their ages live there: a Renovate
    // PR's 7 days count from it) but leave the email, as waiting items do; only Broken
    // and Attention are mailed, so a night with only Watch items sends nothing.
    const needsAttention = withLevels(
      markWaiting(diffed.tagged, next, today, Object.keys(prior).length > 0).filter(
        (it) => it.waiting !== true,
      ),
      next,
      today,
    )
      .filter((it) => it.level !== "watch")
      .map((it) => {
        const since = next[it.key]?.firstFlaggedAt;
        return since ? { ...it, ageDays: daysBetween(since, dayKey) } : it;
      });

    const { log: sendLog, read: sendLogRead } = await readSendLogSafely(options);
    const readySince = nextReadySince(readyKeys, sendLog.readySince, dayKey);
    readyForYourYes.forEach((it, i) => {
      const since = readySince[readyKeys[i]!];
      if (since) it.ageDays = daysBetween(since, dayKey);
    });
    const digestLines: DigestLine[] = [
      ...readyKeys.map((key) => ({ key, metric: 1 })),
      ...needsAttention.map((it) => ({
        key: it.key,
        metric: it.metric,
        ...(it.kind === "lighthouse" ? { tolerance: LIGHTHOUSE_WORSE_POINTS } : {}),
        ...(it.severity === "critical" ? { critical: true } : {}),
        ...(it.askParts ? { asks: it.askParts } : {}),
        ...(it.level !== undefined ? { level: it.level } : {}),
      })),
    ];

    // No-noise default: skip entirely when there's nothing to report.
    if (readyForYourYes.length === 0 && needsAttention.length === 0) {
      // Persist `next` even on a skip: a key that resolved on a quiet day clears so a
      // later recurrence diffs as NEW (spec §10), and — since the skip can now fire
      // with muted pre-exhaustion vulns collected — their keys keep snapshotting so
      // the eventual exhausted-flip diffs as WORSE. Wrapped: a write failure can't
      // fail the skip.
      await persistDigestState(next, options.digestState?.write, () =>
        writeRollupOnce(options, today),
      );
      await writeSendLogSafely(
        options,
        { ...sendLog, sent: nextSent(sendLog.sent, digestLines, dayKey, false), readySince },
        "empty",
        sendLogRead,
      );
      return { output: "Digest skipped (nothing ready, nothing needs attention).", code: 0 };
    }

    const decision = decideDigestSend(digestLines, sendLog, dayKey);
    if (!decision.send) {
      await persistDigestState(next, options.digestState?.write, () =>
        writeRollupOnce(options, today),
      );
      await writeSendLogSafely(
        options,
        { ...sendLog, sent: nextSent(sendLog.sent, digestLines, dayKey, false), readySince },
        decision.reason,
        sendLogRead,
      );
      const last = sendLog.sentOn ?? "never";
      return {
        output: `Digest skipped (unchanged since ${last}; ${digestLines.length} items, heartbeat after ${DIGEST_HEARTBEAT_DAYS} days).`,
        code: 0,
      };
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

    // P1-78d: the badge says what is news in THIS email. An item the last mail did
    // not carry is NEW, one that rose or grew since is WORSE, though the snapshot,
    // which also holds the Watch days no mail carried, calls it standing (a Renovate
    // PR mailed for the first time on its 7th day).
    const changes = digestChanges(digestLines, sendLog);
    const badged = badgeFromSendLog(needsAttention, changes, sendLogRead === "ok");
    const html = renderDigestHtml({ readyForYourYes, needsAttention: badged, submissions });
    const client = options.resend ?? defaultResendClient();
    const to = [operatorEmail()];
    const subject = digestSubject({
      date: digestDateKey(today),
      readyForYourYes,
      needsAttention,
      changes,
      lastSentOn: sendLog.sentOn,
    });
    let result: Awaited<ReturnType<typeof client.send>>;
    try {
      result = await client.send({
        from: FROM_ADDRESS,
        to,
        subject,
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
    await persistDigestState(next, options.digestState?.write, () =>
      writeRollupOnce(options, today),
    );
    await writeSendLogSafely(
      options,
      { sentOn: dayKey, sent: nextSent(sendLog.sent, digestLines, dayKey, true), readySince },
      decision.reason,
      sendLogRead,
    );
    return {
      output: `Digest sent (${decision.reason}) to ${to.join(", ")} (${result.messageId})`,
      code: 0,
    };
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

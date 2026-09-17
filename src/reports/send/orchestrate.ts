import { openBase, readAirtableConfig, type AirtableBase } from "../airtable/client.js";
import { stampSent } from "../airtable/reports.js";
import { updateLaunched } from "../airtable/websites.js";
import { siteSlug, type WebsiteRow } from "../../fleet/site-row.js";
import type { ReportRow } from "../report-row.js";
import { fetchAttachmentBytes } from "../airtable/attachments.js";
import { renderReportFromRow, requireLighthouse } from "./render-from-row.js";
import { defaultResendClient, type ResendClient } from "./resend.js";
import { isIdempotencyConflict } from "./idempotency.js";
import { gatingHealth, isHealthGateClear, isSendOverridden } from "../checklist.js";
import { recordFleetEventsBestEffort } from "../../audits/fleet-events-writer.js";
import type { SiteMirror } from "../../db/site-mirror.js";

const FROM_ADDRESS = "Reddoor Reports <reports@reddoorla.com>";
const REPLY_TO = "info@reddoorla.com";

/** Operations inbox CC'd on every outgoing report so there's always an internal
 *  copy on file alongside the client recipients. */
export const GLOBAL_REPORT_CC = "info@reddoorla.com";

/**
 * Append {@link GLOBAL_REPORT_CC} to a site's per-site CC list. The per-site CC is
 * passed through unchanged (preserving prior behavior); the global address is added
 * only when it isn't already present in the CC or To lists (case-insensitive), so a
 * report is never double-addressed to the ops inbox. Returns the final CC list (may
 * be empty if the global address is already the sole To recipient — the caller omits
 * an empty CC).
 */
export function withGlobalCc(perSiteCc: string[] | null, to: string[]): string[] {
  const cc = [...(perSiteCc ?? [])];
  const present = new Set([...cc, ...to].map((a) => a.toLowerCase()));
  if (!present.has(GLOBAL_REPORT_CC.toLowerCase())) cc.push(GLOBAL_REPORT_CC);
  return cc;
}

export type OrchestrateOptions = {
  resend?: ResendClient;
  /**
   * #646 step 4: the send queue and the fleet roster, read from TURSO.
   *
   * Required rather than defaulted, for the reason the mirrors below are: this
   * function is called directly by tests, and a default would let one reach a
   * live store. The CLI wires `listSendableReports`/`listSites` over one
   * connection.
   */
  sendable: () => Promise<ReportRow[]>;
  roster: () => Promise<WebsiteRow[]>;
  /**
   * The site's header plate, from `sites.header_image*` (design D5 made Turso its
   * source; the re-render path has read it from there since #643). `null` means
   * Turso holds no bytes for that site, and the send falls back to the site's
   * Airtable attachment — which is the ONLY reason this path still reads
   * Airtable, and why the fallback fetches ONE site's record rather than the
   * roster it used to get the signed url from.
   */
  loadHeaderPlate: (siteId: string) => Promise<Uint8Array | null>;
  /** #539 Phase 5: Turso write-through for the Websites row a Launch send
   *  updates. Injected rather than defaulted — this function is called directly
   *  by tests, and a default would open a real libSQL handle inside the suite. */
  siteMirror?: SiteMirror;
  /** #643 (the freeze): Turso write-through for the `Sent at` / `Resend message
   *  ID` stamp. stampSent is what removes a row from listSendableReports, so
   *  once it lands there is no replay left to converge a lost mirror — and the
   *  console's already-sent guards (approve, the commentary lock, re-render)
   *  read `sent_at` from Turso. Injected like siteMirror; the CLI wires it
   *  through `mirrorWrite` so the freeze switch owns the error semantics. */
  reportSentMirror?: (reportId: string, sentAt: Date, messageId: string | null) => Promise<void>;
};

export async function sendApprovedReports(
  options: OrchestrateOptions,
): Promise<{ output: string; code: number }> {
  // Airtable is still opened on this path: `stampSent`, `updateLaunched` and the
  // header fallback below are all Airtable calls. What moved in #646 step 4 are
  // the two READS that decided what the run does at all.
  const base = openBase(readAirtableConfig());
  const client = options.resend ?? defaultResendClient();

  const sendable = await options.sendable();
  if (sendable.length === 0) return { output: "No reports ready to send.", code: 0 };

  const websites = await options.roster();
  const sites = new Map(websites.map((w) => [w.id, w]));

  const lines: string[] = [];
  let anyFailed = false;
  for (const report of sendable) {
    const site = sites.get(report.siteId);
    if (!site) {
      lines.push(`✗ ${report.reportId} — Site row not found for id=${report.siteId}`);
      anyFailed = true;
      continue;
    }
    try {
      const sent = await sendOne(client, base, site, report, options.loadHeaderPlate);
      lines.push(`✓ sent: ${report.reportId} (${sent.display})`);
      // Mirror the stamp into Turso. Caught here rather than thrown so one
      // report's lost mirror still lets the batch continue AND still runs this
      // report's Launch flip below — but it reds the run (`anyFailed`), because
      // post-freeze nothing converges the miss; `db sync --force` is the manual
      // converge during the rollback window.
      try {
        await options.reportSentMirror?.(report.id, sent.sentAt, sent.messageId);
      } catch (e) {
        lines.push(`  ✗ sent-stamp mirror failed for ${report.reportId}: ${(e as Error).message}`);
        anyFailed = true;
      }
      if (report.sendOverride) {
        const failing = gatingHealth({
          reportType: report.reportType,
          autoEvidence: report.autoEvidence ?? {},
        })
          .filter((h) => h.status !== "pass" && h.status !== "n/a")
          .map((h) => h.field);
        await recordFleetEventsBestEffort(
          [
            {
              id: `report_sent_with_override:${report.id}`,
              ts: new Date().toISOString(),
              type: "report_sent_with_override",
              siteId: site.id,
              siteName: site.name,
              summary: `sent with override — ${report.overrideReason ?? ""}`,
              data: { reportId: report.reportId, reason: report.overrideReason, failing },
            },
          ],
          new Date(),
        );
      }
      if (report.reportType === "Launch") {
        try {
          const fields = await updateLaunched(base, site.id, new Date().toISOString());
          // Status and `Launched at` travel together — mirroring them as two
          // updates would open a window where Turso says a site is maintained
          // but never launched.
          await options.siteMirror?.site(site.id, fields);
          lines.push(`  ↳ launched: ${site.name} flipped to maintained`);
          await recordFleetEventsBestEffort(
            [
              {
                id: `site_launched:${site.id}`,
                ts: new Date().toISOString(),
                type: "site_launched",
                siteId: site.id,
                siteName: site.name,
                summary: "launched — now in maintenance",
                data: null,
              },
            ],
            new Date(),
          );
        } catch (e) {
          // Post-freeze a swallowed flip failure is permanent divergence: Turso
          // — the store lead routing reads — would keep the site in
          // launch-period forever (its leads go operator-only). Red the run
          // instead of shrugging; the email itself already went out.
          lines.push(`  ⚠ launch flip failed for ${site.name}: ${(e as Error).message}`);
          anyFailed = true;
        }
      }
    } catch (e) {
      lines.push(`✗ ${report.reportId} — ${(e as Error).message}`);
      anyFailed = true;
    }
  }
  return { output: lines.join("\n"), code: anyFailed ? 1 : 0 };
}

/**
 * The header plate for one send: Turso first, the site's Airtable attachment as
 * the fallback (#646 step 4).
 *
 * Turso first for the reason the re-render path already had: the bytes are local,
 * and an Airtable attachment url is SIGNED and expiring, so fetching one when the
 * same image is already in hand is latency plus a dependency on a url that may be
 * dead. The fallback exists because the plate columns were backfilled, not
 * enforced — a site whose image never made it across must still be able to send,
 * exactly as it did before this change.
 *
 * The fallback is a ONE-SITE Airtable lookup, not the whole Websites table: the
 * roster no longer comes from Airtable, so the signed url is not already in hand.
 * A site with no record there (every `site_<ULID>` site) and no plate gets a named
 * error with the command that fixes it — not a silent unillustrated report.
 */
async function headerPlateFor(
  base: AirtableBase,
  site: WebsiteRow,
  loadHeaderPlate: (siteId: string) => Promise<Uint8Array | null>,
): Promise<{ bytes: Uint8Array; source: "turso" | "airtable" }> {
  const stored = await loadHeaderPlate(site.id);
  if (stored) return { bytes: stored, source: "turso" };
  const slug = siteSlug(site.name);
  const { findWebsiteRecordBySlug } = await import("../airtable/ensure-site.js");
  const { mapRow } = await import("../airtable/websites.js");
  const rec = slug ? await findWebsiteRecordBySlug(base, slug) : null;
  const url = rec ? mapRow(rec).headerImage?.url : undefined;
  if (!url) {
    throw new Error(
      `Site '${site.name}' has no Header image: no header plate in Turso and no Airtable ` +
        `attachment to fall back to — run \`reddoor-maint header-image ${slug || site.name} --write-back\``,
    );
  }
  return { bytes: (await fetchAttachmentBytes(url)).bytes, source: "airtable" };
}

/** What the caller needs to mirror the stamp: the exact values stampSent wrote
 *  (`messageId` null on the 409 path, where Airtable's field is left untouched
 *  too), plus the display string for the ✓ line. */
type SentStamp = { display: string; sentAt: Date; messageId: string | null };

async function sendOne(
  client: ResendClient,
  base: ReturnType<typeof openBase>,
  site: WebsiteRow,
  report: ReportRow,
  loadHeaderPlate: (siteId: string) => Promise<Uint8Array | null>,
): Promise<SentStamp> {
  // Hard health gate: a Maintenance/Testing report whose gating evidence isn't all pass/n/a must
  // never go out — even if "Approved to send" was set directly in Airtable. Throw so the row is
  // skipped and `Sent at` stays null (at-least-once retry preserved). Launch/Announcement have no
  // gating fields → vacuously clear. A logged send-anyway override (Phase 10) bypasses the gate.
  const gateReport = { reportType: report.reportType, autoEvidence: report.autoEvidence ?? {} };
  if (!isHealthGateClear(gateReport) && !isSendOverridden(report)) {
    const failing = gatingHealth(gateReport)
      .filter((h) => h.status !== "pass" && h.status !== "n/a")
      .map((h) => {
        const note = report.autoEvidence?.[h.field]?.note;
        return `${h.field} (${h.status}${note ? `: ${note}` : ""})`;
      })
      .join("; ");
    throw new Error(`Report ${report.reportId} health gate not clear — ${failing}`);
  }
  // Fail fast, before the header fetch and the sharp downscale. Same rule and
  // same message the renderer enforces — shared, not restated.
  requireLighthouse(report);

  // Resolve + validate recipients BEFORE the expensive work (header fetch + sharp
  // downscale + full MJML render). A misconfigured-recipients site is a guaranteed
  // failure, so fail fast here rather than after burning that work. Same checks +
  // messages as before — only the position moved.
  const explicitTo = parseAddresses(site.reportRecipientsTo);
  // Run pointOfContact through the parser too — operators sometimes paste
  // "a@x, b@y" into that single-line field.
  const fallbackTo = parseAddresses(site.pointOfContact);
  const to = explicitTo ?? fallbackTo ?? [];
  if (to.length === 0) {
    throw new Error(
      `Site '${site.name}' has no recipients (Report recipients (To) AND point of contact are both empty)`,
    );
  }
  for (const addr of to) {
    if (!isProbablyEmail(addr)) {
      throw new Error(
        `Site '${site.name}' recipient is malformed: ${addr} — use a bare address only ` +
          `(no \`Name <addr>\` display-name syntax); fix Report recipients (To) or point of contact in Airtable`,
      );
    }
  }
  const cc = parseAddresses(site.reportRecipientsCc);
  if (cc) {
    for (const addr of cc) {
      if (!isProbablyEmail(addr)) {
        throw new Error(
          `Site '${site.name}' CC is malformed: ${addr} — fix Report recipients (CC) in Airtable`,
        );
      }
    }
  }

  const header = await headerPlateFor(base, site, loadHeaderPlate);
  console.log(`REPORT_SEND report=${report.reportId} site=${site.name} header=${header.source}`);
  // ONE render path, shared with the console's on-demand re-render — so a
  // preview cannot drift from what the client actually receives. The assembly
  // that used to live here moved into renderReportFromRow unchanged.
  const { html, attachments, subject } = await renderReportFromRow(site, report, header.bytes);

  const payload: Parameters<ResendClient["send"]>[0] = {
    from: FROM_ADDRESS,
    to,
    replyTo: REPLY_TO,
    subject,
    html,
    attachments,
    // Stable across retries of the same row — if Airtable stamping fails after a
    // successful Resend, the next --send-ready replays with the same key and
    // Resend returns the original message id rather than sending a duplicate.
    idempotencyKey: `report:${report.id}`,
  };
  // Always CC the ops inbox (info@reddoorla.com), in addition to any per-site CC.
  const finalCc = withGlobalCc(cc, to);
  if (finalCc.length > 0) payload.cc = finalCc;

  let result: Awaited<ReturnType<ResendClient["send"]>>;
  try {
    result = await client.send(payload);
  } catch (err) {
    // The send path is at-least-once: client.send succeeds → stampSent writes
    // `Sent at` (the ONLY thing that removes the row from listSendableReports). If
    // stampSent threw on a PRIOR run (an Airtable blip), `Sent at` stayed null and
    // the row replays here. By replay time the rendered body has usually changed
    // (operator Commentary edit, `report --due` rewrote scores, or the header
    // re-encodes non-deterministically), so Resend rejects the same-key
    // (`report:<id>`) / different-body re-send with a 409 (`invalid_idempotent_request`).
    //
    // That 409 means the email ALREADY WENT OUT under this key on the prior run.
    // Do NOT re-throw and do NOT re-send (re-throwing leaves the row unstamped, and
    // after the 24h key TTL a SECOND real email would go out). Instead stamp the row
    // so it stops replaying, then return success so the caller runs the Launch flip —
    // which self-heals a launch that sent-but-never-flipped on the prior run.
    //
    // Any OTHER error (real network/Resend failure) re-throws, exactly as before, so
    // a genuine failure still fails loudly and the row replays next run.
    if (isIdempotencyConflict(err)) {
      // Stamp `Sent at` ONLY — the original send's messageId is unrecoverable on
      // the 409 path, so we leave `Resend message ID` null rather than writing a
      // sentinel that would masquerade as a real id and orphan webhook lookups.
      // Still return the sentinel string so the caller logs the already-sent path
      // and runs the Launch flip.
      const when = new Date();
      await stampSent(base, report.id, when, null);
      console.log(`↻ already sent (idempotency conflict), stamped: ${report.reportId}`);
      return { display: "idempotent-conflict", sentAt: when, messageId: null };
    }
    throw err;
  }
  const when = new Date();
  await stampSent(base, report.id, when, result.messageId);
  return { display: result.messageId, sentAt: when, messageId: result.messageId };
}

/**
 * Split a comma/newline-separated address field into a clean array.
 * Lowercases (case-insensitive dedupe) and removes empty entries. Returns
 * null if nothing survives. Does NOT understand `Display Name <email>` —
 * operators should put a bare address in the Airtable field, or use multiple
 * lines if needing multiple recipients.
 */
export function parseAddresses(field: string | null): string[] | null {
  if (!field) return null;
  const seen = new Set<string>();
  const list: string[] = [];
  for (const raw of field.split(/[,\n]/)) {
    const trimmed = raw.trim().toLowerCase();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    list.push(trimmed);
  }
  return list.length > 0 ? list : null;
}

/**
 * Cheap email shape check — must contain exactly one @, with non-empty
 * local and domain parts and at least one dot in the domain. We're not
 * trying to be a full RFC validator; we're trying to catch operator
 * mistakes like "ops at acme dot com" or a missing @ before they 422
 * at Resend.
 */
export function isProbablyEmail(s: string): boolean {
  const at = s.indexOf("@");
  if (at < 1 || at !== s.lastIndexOf("@")) return false;
  const local = s.slice(0, at);
  const domain = s.slice(at + 1);
  if (!local || !domain) return false;
  if (!domain.includes(".")) return false;
  if (/\s/.test(s)) return false;
  return true;
}

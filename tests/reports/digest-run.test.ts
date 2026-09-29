import { describe, it, expect, beforeEach, vi } from "vitest";
import { runDigest, buildSubmissionsDigestSection } from "../../src/reports/digest.js";
import { isPendingApproval } from "../../src/reports/report-row.js";
import type { SiteSubmissionCounts } from "../../src/db/submissions.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";
import type { ResendClient, ResendSendInput } from "../../src/reports/send/resend.js";
import { websiteRowsFrom, reportRowsFrom, type RawRow } from "../_helpers/raw-rows.js";
import { OPERATOR_FALLBACK } from "../../src/util/operator.js";
import type { DigestSendLog } from "../../src/alerts/digest-send.js";

/** #609: the digest reads its prior snapshot from Turso, and the read is
 *  deliberately NOT defensive — swallowing a failure would badge every item NEW.
 *  That makes libSQL a hard requirement of a real run, so the suite injects an
 *  in-memory store instead of pretending one exists. Fresh per call, so a test
 *  that does not seed it sees the empty-snapshot case (everything NEW).
 */
function memoryDigestState(
  seed: Record<string, { metric: number; firstFlaggedAt: string; exhausted?: boolean }> = {},
) {
  let snap = seed;
  return {
    read: async () => snap,
    write: async (next: typeof snap) => {
      snap = next;
    },
  };
}

beforeEach(() => {
  process.env.OPERATOR_EMAIL = "tucker@reddoorla.com";
});

// ── seed helpers ────────────────────────────────────────────────────────────

function siteRow(over: Partial<RawRow["fields"]> = {}): RawRow {
  return {
    id: "rec_site_acme",
    fields: {
      Name: "Acme Co",
      url: "https://acme.example.com",
      // Send-clean: the preflight collector surfaces unsent drafts with send
      // blockers, so skip-path fixtures need recipients + header + scores.
      "point of contact": "owner@acme.example.com",
      "Header image": [{ url: "https://x/h.png", filename: "h.png", type: "image/png" }],
      ...over,
    },
  };
}

/** An all-pass Maintenance gating-evidence map, so the pending/approved report
 *  fixtures below stay health-clean and keep testing exactly what they tested
 *  before healthBlockers was folded into approveBlockers (health-gate phase 8)
 *  — the digest's preflight collector now reads this too. Tests that care about
 *  health override the field explicitly. */
const healthCleanEvidence = (): string =>
  JSON.stringify({
    "Maint: Deploy & Function Health": {
      result: "pass",
      checkedAt: "2026-07-06T00:00:00.000Z",
      note: "",
    },
    "Maint: CMS Checked": { result: "pass", checkedAt: "2026-07-06T00:00:00.000Z", note: "" },
    "Maint: Domain, DNS & SSL": { result: "pass", checkedAt: "2026-07-06T00:00:00.000Z", note: "" },
    "Maint: Security Updates": { result: "pass", checkedAt: "2026-07-06T00:00:00.000Z", note: "" },
    "Maint: Uptime Checked": { result: "pass", checkedAt: "2026-07-06T00:00:00.000Z", note: "" },
  });

/** A report that IS pending approval: draftReady=true, approvedToSend=false, sentAt=null. */
function readyReport(over: Partial<RawRow["fields"]> = {}): RawRow {
  return {
    id: "rec_report_ready",
    fields: {
      "Report ID": "Acme Co — Maintenance — 2026-06",
      Site: ["rec_site_acme"],
      "Report type": "Maintenance",
      Period: "2026-06",
      "Period start": "2026-05-01",
      "Period end": "2026-05-31",
      "Completed on": "2026-05-31",
      "Lighthouse — Performance": 87,
      "Lighthouse — Accessibility": 91,
      "Lighthouse — Best Practices": 100,
      "Lighthouse — SEO": 95,
      "Draft ready": true,
      "Approved to send": false,
      // "Sent at" absent → sentAt === null
      "Delivery status": "pending",
      "Checklist auto-evidence": healthCleanEvidence(),
      ...over,
    },
  };
}

/** A report that is already approved — must be EXCLUDED by isPendingApproval. */
function approvedReport(over: Partial<RawRow["fields"]> = {}): RawRow {
  return {
    ...readyReport(),
    id: "rec_report_approved",
    fields: {
      ...readyReport().fields,
      "Report ID": "Acme Co — Maintenance — 2026-05",
      Period: "2026-05",
      "Approved to send": true,
      ...over,
    },
  };
}

/** A report that was already sent — must be EXCLUDED by isPendingApproval. */
function sentReport(over: Partial<RawRow["fields"]> = {}): RawRow {
  return {
    ...readyReport(),
    id: "rec_report_sent",
    fields: {
      ...readyReport().fields,
      "Report ID": "Acme Co — Maintenance — 2026-04",
      Period: "2026-04",
      "Sent at": "2026-04-30T10:00:00.000Z",
      ...over,
    },
  };
}

/** A report where draft is not ready — must be EXCLUDED by isPendingApproval. */
function unreadyReport(over: Partial<RawRow["fields"]> = {}): RawRow {
  return {
    ...readyReport(),
    id: "rec_report_unready",
    fields: {
      ...readyReport().fields,
      "Report ID": "Acme Co — Maintenance — 2026-03",
      Period: "2026-03",
      "Draft ready": false,
      ...over,
    },
  };
}

/** A site carrying a critical vuln whose Renovate auto-fix is EXHAUSTED — the digest
 *  emails it. (Pre-exhaustion vulns are muted from the email while the fleet is still
 *  self-patching — see the dedicated mute tests — so the stock attention fixture must
 *  be the exhausted, notify-worthy kind.) */
function vulnSiteRow(over: Partial<RawRow["fields"]> = {}): RawRow {
  return {
    id: "rec_site_acme",
    fields: {
      Name: "Acme Co",
      url: "https://acme.example.com",
      "Security Vulns Critical": 1,
      "Security Auto-Fix Attempts": 3,
      ...over,
    },
  };
}

/** A vulnSiteRow with critical+high both 0 — collectVulnAlerts skips it. */
function cleanSiteRow(over: Partial<RawRow["fields"]> = {}): RawRow {
  return vulnSiteRow({
    "Security Vulns Critical": 0,
    "Security Vulns High": 0,
    ...over,
  });
}

/** A bounced report — collectDeliveryFailures flags it. */
function bouncedReport(over: Partial<RawRow["fields"]> = {}): RawRow {
  return {
    id: "rec_report_bounced",
    fields: {
      "Report ID": "Acme Co — Maintenance — 2026-06",
      Site: ["rec_site_acme"],
      "Report type": "Maintenance",
      Period: "2026-06",
      "Delivery status": "bounced",
      ...over,
    },
  };
}

function captureClient(): { client: ResendClient; captured: ResendSendInput[] } {
  const captured: ResendSendInput[] = [];
  const client: ResendClient = {
    async send(input) {
      captured.push(input);
      return { messageId: `msg_${captured.length}` };
    },
  };
  return { client, captured };
}

/** A Resend client whose send() always rejects — for error-contract tests. */
function rejectClient(message = "network error"): ResendClient {
  return {
    async send() {
      throw new Error(message);
    },
  };
}

/**
 * A Resend client whose send() rejects with the real idempotency-conflict error
 * Resend returns on a same-key + DIFFERENT-body re-send within 24h. Mirrors the
 * message ResendClient surfaces (resend.ts wraps it as `Resend error: <message>`).
 */
function idempotencyConflictClient(): ResendClient {
  return {
    async send() {
      throw new Error(
        "Resend error: This idempotency key has been used with this HTTP method and endpoint " +
          "within the last 24 hours, but the request body was modified and doesn't match the " +
          "original request.",
      );
    },
  };
}

// ── isPendingApproval ────────────────────────────────────────────────────────

/** #646 step 4: runDigest reads its two datasets from TURSO, through the injected
 *  readers below. A Turso-backed run end to end is tests/reports/digest-turso.test.ts. */
const io = (tables: { Websites: RawRow[]; Reports: RawRow[] }) => ({
  roster: async () => websiteRowsFrom(tables.Websites),
  allReports: async () => reportRowsFrom(tables.Reports),
});

const pendingOf = (records: RawRow[]) => reportRowsFrom(records).filter(isPendingApproval);

describe("isPendingApproval", () => {
  it("returns only draftReady=true, approvedToSend=false, sentAt=null rows", () => {
    const rows = pendingOf([readyReport(), approvedReport(), sentReport(), unreadyReport()]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe("rec_report_ready");
  });

  it("returns empty array when no reports match", () => {
    const rows = pendingOf([approvedReport(), sentReport(), unreadyReport()]);
    expect(rows).toHaveLength(0);
  });

  it("does NOT return an approved report", () => {
    const rows = pendingOf([approvedReport()]);
    expect(rows.every((r) => !r.approvedToSend)).toBe(true);
  });

  it("does NOT return a sent report", () => {
    const rows = pendingOf([sentReport()]);
    expect(rows.every((r) => r.sentAt === null)).toBe(true);
  });

  it("does NOT return an unready report", () => {
    const rows = pendingOf([unreadyReport()]);
    expect(rows.every((r) => r.draftReady)).toBe(true);
  });
});

// ── runDigest ────────────────────────────────────────────────────────────────

describe("runDigest", () => {
  it("skips when there is nothing pending and nothing needing attention", async () => {
    const tables = { Reports: [], Websites: [] };
    const result = await runDigest({
      digestState: memoryDigestState(),
      ...io(tables),
      baseUrl: "https://reddoor-maintenance.netlify.app",
    });
    expect(result.code).toBe(0);
    expect(result.output).toContain("skipped");
  });

  it("skips when only non-pending reports exist (all approved/sent/unready)", async () => {
    const tables = {
      Reports: [approvedReport(), sentReport(), unreadyReport()],
      Websites: [siteRow()],
    };
    const result = await runDigest({
      digestState: memoryDigestState(),
      ...io(tables),
      baseUrl: "https://reddoor-maintenance.netlify.app",
    });
    expect(result.code).toBe(0);
    expect(result.output).toContain("skipped");
  });

  it("sends a digest (Needs attention) when an APPROVED report has send blockers", async () => {
    const tables = {
      Reports: [approvedReport()],
      Websites: [siteRow({ "point of contact": undefined, "Header image": undefined })],
    };
    const { client, captured } = captureClient();
    const result = await runDigest({
      digestState: memoryDigestState(),
      ...io(tables),
      resend: client,
      baseUrl: "https://reddoor-maintenance.netlify.app",
    });
    expect(result.code).toBe(0);
    expect(captured).toHaveLength(1);
    expect(captured[0]!.html).toContain("will fail at send");
    expect(captured[0]!.html).toContain("recipients-missing");
  });

  it("sends a digest when a ready report exists", async () => {
    const tables = { Reports: [readyReport()], Websites: [siteRow()] };
    const { client, captured } = captureClient();
    const result = await runDigest({
      digestState: memoryDigestState(),
      ...io(tables),
      resend: client,
      baseUrl: "https://reddoor-maintenance.netlify.app",
    });
    expect(result.code).toBe(0);
    expect(captured).toHaveLength(1);
    const sent = captured[0]!;
    expect(sent.from).toBe("Reddoor Reports <reports@reddoorla.com>");
    expect(sent.to).toEqual(["tucker@reddoorla.com"]);
    expect(sent.idempotencyKey).toMatch(/^digest-\d{4}-\d{2}-\d{2}$/);
    expect(sent.html).toContain("Acme Co");
  });

  it("links a pending item to the fleet homepage (not a dead /s/) when the site Name slugs to empty", async () => {
    // "!!!" → siteSlug "" → a `/s/` link would be a 404 (getWebsiteBySlug can't
    // match an empty slug). The digest must fall back to the base homepage.
    const tables = {
      Reports: [readyReport()],
      Websites: [siteRow({ Name: "!!!" })],
    };
    const { client, captured } = captureClient();
    await runDigest({
      digestState: memoryDigestState(),
      ...io(tables),
      resend: client,
      baseUrl: "https://reddoor-maintenance.netlify.app",
    });
    const html = captured[0]!.html;
    expect(html).toContain('href="https://reddoor-maintenance.netlify.app"');
    expect(html).not.toContain("/s/"); // no malformed empty-slug link
  });

  it("subject is dated and uses correct singular form for 1 report", async () => {
    const tables = { Reports: [readyReport()], Websites: [siteRow()] };
    const { client, captured } = captureClient();
    await runDigest({
      digestState: memoryDigestState(),
      ...io(tables),
      resend: client,
      baseUrl: "https://reddoor-maintenance.netlify.app",
    });
    // Expected: "Your fleet — YYYY-MM-DD: 1 report ready for your yes"
    expect(captured[0]!.subject).toMatch(
      /^Your fleet — \d{4}-\d{2}-\d{2}: 1 report ready for your yes$/,
    );
  });

  it("subject uses plural form for 2+ reports", async () => {
    // Second site + second report
    const site2: RawRow = {
      id: "rec_site_beta",
      fields: { Name: "Beta Ltd", url: "https://beta.example.com" },
    };
    const report2 = readyReport({
      "Report ID": "Beta Ltd — Maintenance — 2026-06",
      Site: ["rec_site_beta"],
      Period: "2026-06",
    });
    report2.id = "rec_report_ready_2";
    const tables = {
      Reports: [readyReport(), report2],
      Websites: [siteRow(), site2],
    };
    const { client, captured } = captureClient();
    await runDigest({
      digestState: memoryDigestState(),
      ...io(tables),
      resend: client,
      baseUrl: "https://reddoor-maintenance.netlify.app",
    });
    // Expected: "Your fleet — YYYY-MM-DD: 2 reports ready for your yes"
    expect(captured[0]!.subject).toMatch(
      /^Your fleet — \d{4}-\d{2}-\d{2}: 2 reports ready for your yes$/,
    );
  });

  it("includes the correct dashboard URL for the site", async () => {
    const tables = { Reports: [readyReport()], Websites: [siteRow()] };
    const { client, captured } = captureClient();
    await runDigest({
      digestState: memoryDigestState(),
      ...io(tables),
      resend: client,
      baseUrl: "https://reddoor-maintenance.netlify.app",
    });
    expect(captured[0]!.html).toContain("/s/acme-co");
  });

  it("strips trailing slash from baseUrl before building dashboard links", async () => {
    const tables = { Reports: [readyReport()], Websites: [siteRow()] };
    const { client, captured } = captureClient();
    await runDigest({
      digestState: memoryDigestState(),
      ...io(tables),
      resend: client,
      baseUrl: "https://reddoor-maintenance.netlify.app/",
    });
    // Must not produce double slashes like /s//acme-co
    expect(captured[0]!.html).not.toContain("//s/");
    expect(captured[0]!.html).toContain("/s/acme-co");
  });

  it("surfaces an orphan report (site row missing) as site-not-found instead of a broken ready-link", async () => {
    // Report points at rec_site_acme but Websites table is empty. The ready
    // section still skips it (no broken /s/ link), but the preflight collector
    // now names it — an orphan draft is a send that WILL fail.
    const tables = { Reports: [readyReport()], Websites: [] };
    const { client, captured } = captureClient();
    const result = await runDigest({
      digestState: memoryDigestState(),
      ...io(tables),
      resend: client,
      baseUrl: "https://reddoor-maintenance.netlify.app",
    });
    expect(result.code).toBe(0);
    expect(captured).toHaveLength(1);
    expect(captured[0]!.html).toContain("site-not-found");
    expect(captured[0]!.html).not.toContain("/s/rec");
  });

  it("returns the Resend message id in the output string", async () => {
    const tables = { Reports: [readyReport()], Websites: [siteRow()] };
    const { client } = captureClient();
    const result = await runDigest({
      digestState: memoryDigestState(),
      ...io(tables),
      resend: client,
      baseUrl: "https://reddoor-maintenance.netlify.app",
    });
    expect(result.output).toContain("msg_1");
  });

  it("falls back to the operator inbox when OPERATOR_EMAIL is unset", async () => {
    delete process.env.OPERATOR_EMAIL;
    const tables = { Reports: [readyReport()], Websites: [siteRow()] };
    const { client, captured } = captureClient();
    await runDigest({
      digestState: memoryDigestState(),
      ...io(tables),
      resend: client,
      baseUrl: "https://reddoor-maintenance.netlify.app",
    });
    expect(captured[0]!.to).toEqual([OPERATOR_FALLBACK]);
  });

  // ── error contract ──────────────────────────────────────────────────────────

  it("returns code 1 and a tidy message when resend.send rejects", async () => {
    const tables = { Reports: [readyReport()], Websites: [siteRow()] };
    const result = await runDigest({
      digestState: memoryDigestState(),
      ...io(tables),
      resend: rejectClient("network error"),
      baseUrl: "https://reddoor-maintenance.netlify.app",
    });
    expect(result.code).toBe(1);
    expect(result.output).toBe("digest failed: network error");
  });

  // ── idempotency-conflict graceful skip ───────────────────────────────────────

  it("treats a same-day Resend idempotency-conflict as a graceful skip (code 0), not a failure", async () => {
    // Second same-UTC-day run whose content changed → Resend 409
    // (invalid_idempotent_request). The operator already got today's digest on the
    // first send; re-sending a changed body would just be a duplicate, so skip.
    const tables = { Reports: [readyReport()], Websites: [siteRow()] };
    const result = await runDigest({
      digestState: memoryDigestState(),
      ...io(tables),
      resend: idempotencyConflictClient(),
      baseUrl: "https://reddoor-maintenance.netlify.app",
    });
    expect(result.code).toBe(0);
    expect(result.output).toMatch(/already sent today/i);
  });

  it("does NOT write the Digest State snapshot on an idempotency-conflict skip", async () => {
    // The FIRST send already persisted the snapshot; writing this run's `next` would
    // diff against the first run's snapshot and mis-badge. No state write must occur.
    const tables = { Reports: [bouncedReport()], Websites: [vulnSiteRow()] };
    const store = memoryDigestState();
    const write = vi.spyOn(store, "write");
    const result = await runDigest({
      digestState: store,
      ...io(tables),
      resend: idempotencyConflictClient(),
      baseUrl: "https://reddoor-maintenance.netlify.app",
    });
    expect(result.code).toBe(0);
    expect(write).not.toHaveBeenCalled();
  });

  it("a GENERIC send error still propagates to code 1 (must fail loudly, not skip)", async () => {
    // A real Resend/network failure (no idempotency-key wording) must NOT be swallowed
    // as a skip — it still falls through to the outer catch → {code:1}.
    const tables = { Reports: [readyReport()], Websites: [siteRow()] };
    const result = await runDigest({
      digestState: memoryDigestState(),
      ...io(tables),
      resend: rejectClient("Resend 500"),
      baseUrl: "https://reddoor-maintenance.netlify.app",
    });
    expect(result.code).toBe(1);
    expect(result.output).toBe("digest failed: Resend 500");
  });

  // ── exitCode passthrough ────────────────────────────────────────────────────

  it("re-throws errors that carry a numeric exitCode property (config errors propagate)", async () => {
    const configError = Object.assign(new Error("missing RESEND_API_KEY"), { exitCode: 2 });
    const tables = { Reports: [readyReport()], Websites: [siteRow()] };
    const badClient: ResendClient = {
      async send() {
        throw configError;
      },
    };
    await expect(
      runDigest({
        digestState: memoryDigestState(),
        ...io(tables),
        resend: badClient,
        baseUrl: "https://reddoor-maintenance.netlify.app",
      }),
    ).rejects.toThrow("missing RESEND_API_KEY");
  });

  it("returns {code:1} for a plain Error with no exitCode (runtime errors are swallowed)", async () => {
    const tables = { Reports: [readyReport()], Websites: [siteRow()] };
    const result = await runDigest({
      digestState: memoryDigestState(),
      ...io(tables),
      resend: rejectClient("network error"),
      baseUrl: "https://reddoor-maintenance.netlify.app",
    });
    expect(result.code).toBe(1);
    expect(result.output).toBe("digest failed: network error");
  });

  it("returns code 1 and a tidy message when the roster read rejects", async () => {
    const tables = { Reports: [readyReport()], Websites: [siteRow()] };
    const { client } = captureClient();
    const result = await runDigest({
      digestState: memoryDigestState(),
      ...io(tables),
      roster: async () => {
        throw new Error("turso down");
      },
      resend: client,
      baseUrl: "https://reddoor-maintenance.netlify.app",
    });
    expect(result.code).toBe(1);
    expect(result.output).toMatch(/^digest failed: /);
  });

  // ── fetch dedup ────────────────────────────────────────────────────────────

  it("reads the roster once and the reports once for the whole run (no duplicate reads)", async () => {
    // A ready report + a vuln site → the full path runs: ready-list, attention
    // collect, and state read all execute. Each dataset must be read exactly once
    // across the entire run.
    const tables = { Reports: [readyReport()], Websites: [vulnSiteRow()] };
    const roster = vi.fn(async () => websiteRowsFrom(tables.Websites));
    const allReports = vi.fn(async () => reportRowsFrom(tables.Reports));
    const { client } = captureClient();
    await runDigest({
      digestState: memoryDigestState(),
      roster,
      allReports,
      resend: client,
      baseUrl: "https://reddoor-maintenance.netlify.app",
    });

    expect(roster).toHaveBeenCalledTimes(1);
    expect(allReports).toHaveBeenCalledTimes(1);
  });

  // ── attention wiring ─────────────────────────────────────────────────────────

  it("surfaces a vuln + a delivery item, both NEW, on the first run (no prior state)", async () => {
    const tables = {
      Reports: [bouncedReport()],
      Websites: [vulnSiteRow()],
    };
    const { client, captured } = captureClient();
    const result = await runDigest({
      digestState: memoryDigestState(),
      ...io(tables),
      resend: client,
      baseUrl: "https://reddoor-maintenance.netlify.app",
    });
    expect(result.code).toBe(0);
    expect(captured).toHaveLength(1);
    const html = captured[0]!.html;
    expect(html).toContain("Needs attention");
    // Both signals present and badged NEW on first sight.
    expect(html).toContain("Acme Co");
    expect(html).toMatch(/NEW/);
    expect(html).not.toMatch(/all clear/i);
  });

  it("sends the digest on attention alone, even with nothing pending approval", async () => {
    // No ready reports — only a vuln. The no-noise skip must NOT fire.
    const tables = { Reports: [], Websites: [vulnSiteRow()] };
    const { client, captured } = captureClient();
    const result = await runDigest({
      digestState: memoryDigestState(),
      ...io(tables),
      resend: client,
      baseUrl: "https://reddoor-maintenance.netlify.app",
    });
    expect(result.code).toBe(0);
    expect(captured).toHaveLength(1);
    expect(captured[0]!.html).toContain("Acme Co");
  });

  it("writes the next snapshot to Digest State after sending", async () => {
    const tables = { Reports: [bouncedReport()], Websites: [vulnSiteRow()] };
    const { client } = captureClient();
    const store = memoryDigestState();
    const write = vi.spyOn(store, "write");
    await runDigest({
      digestState: store,
      ...io(tables),
      resend: client,
      baseUrl: "https://reddoor-maintenance.netlify.app",
    });
    expect(write).toHaveBeenCalledTimes(1);
    const snap = await store.read();
    expect(snap["vuln:rec_site_acme"]).toBeDefined();
    expect(snap["delivery:rec_report_bounced"]).toBeDefined();
  });

  it("second run with prior state seeded shows STANDING (no NEW/WORSE badge)", async () => {
    // `exhausted: true` seeded: the fixture vuln is exhausted, so a prior WITHOUT the
    // flag would diff the flip as WORSE — this test wants the steady state.
    const prior = JSON.stringify({
      "vuln:rec_site_acme": { metric: 1, firstFlaggedAt: "2026-06-10", exhausted: true },
      "delivery:rec_report_bounced": { metric: 1, firstFlaggedAt: "2026-06-10" },
    });
    const tables = {
      Reports: [bouncedReport()],
      Websites: [vulnSiteRow()],
    };
    const { client, captured } = captureClient();
    await runDigest({
      digestState: memoryDigestState(JSON.parse(prior)),
      ...io(tables),
      resend: client,
      baseUrl: "https://reddoor-maintenance.netlify.app",
    });
    const html = captured[0]!.html;
    expect(html).toContain("Acme Co"); // standing problem still rendered
    expect(html).not.toMatch(/\bNEW\b/);
    expect(html).not.toMatch(/\bWORSE\b/);
  });

  it("writes the snapshot to Turso and says so (#609)", async () => {
    // The DIGEST_STATE_WRITE line exists because of #585 — a write that silently
    // stopped running looked identical to a healthy one for weeks.
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const tables = { Reports: [bouncedReport()], Websites: [vulnSiteRow()] };
    const { client } = captureClient();
    const store = memoryDigestState();

    await runDigest({
      digestState: store,
      ...io(tables),
      resend: client,
      baseUrl: "https://reddoor-maintenance.netlify.app",
    });

    expect(Object.keys(await store.read()).length).toBeGreaterThan(0);
    expect((log.mock.calls as unknown[][]).flat().join("\n")).toMatch(
      /^DIGEST_STATE_WRITE turso=1 rollup=(1|0|absent)$/m,
    );
    log.mockRestore();
  });

  it("writes the cockpit roll-up and says so (MED-16)", async () => {
    // The roll-up is what lets the fleet homepage stop aggregating over
    // `submissions` per request. If this write silently stops, the cockpit's
    // spam and bounce strips go ABSENT — which is the honest failure, but only
    // if someone notices, hence the counter on the line.
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const tables = { Reports: [bouncedReport()], Websites: [vulnSiteRow()] };
    const { client } = captureClient();
    const seen: Date[] = [];

    await runDigest({
      digestState: memoryDigestState(),
      cockpitRollup: {
        write: async (now) => {
          seen.push(now);
        },
      },
      ...io(tables),
      resend: client,
      baseUrl: "https://reddoor-maintenance.netlify.app",
    });

    expect(seen).toHaveLength(1);
    expect((log.mock.calls as unknown[][]).flat().join("\n")).toContain("rollup=1");
    log.mockRestore();
  });

  it("reports rollup=0 when the roll-up write fails, and still sends", async () => {
    // Same contract as the turso half: a dead writer must be visibly dead. The
    // digest has already gone out by this point, so it must not turn the run red.
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tables = { Reports: [bouncedReport()], Websites: [vulnSiteRow()] };
    const { client, captured } = captureClient();

    const result = await runDigest({
      digestState: memoryDigestState(),
      cockpitRollup: {
        write: () => Promise.reject(new Error("turso down")),
      },
      ...io(tables),
      resend: client,
      baseUrl: "https://reddoor-maintenance.netlify.app",
    });

    expect(result.code).toBe(0); // the email already went out
    expect(captured).toHaveLength(1);
    expect((log.mock.calls as unknown[][]).flat().join("\n")).toContain("rollup=0");
    log.mockRestore();
    warn.mockRestore();
  });

  it("reports turso=0 when the Turso write fails, and still sends (#609)", async () => {
    // A dead write must be visibly dead. Counting it as a plain success is the
    // exact shape that hid #585 for weeks.
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tables = { Reports: [bouncedReport()], Websites: [vulnSiteRow()] };
    const { client, captured } = captureClient();

    const result = await runDigest({
      digestState: {
        read: async () => ({}),
        write: async () => {
          throw new Error("turso down");
        },
      },
      ...io(tables),
      resend: client,
      baseUrl: "https://reddoor-maintenance.netlify.app",
    });

    expect(result.code).toBe(0); // the email already went out
    expect(captured).toHaveLength(1);
    expect((log.mock.calls as unknown[][]).flat().join("\n")).toMatch(
      /^DIGEST_STATE_WRITE turso=0 rollup=(1|0|absent)$/m,
    );
    log.mockRestore();
    warn.mockRestore();
  });

  it("a state write failure is caught and logged; the run still reports success", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tables = { Reports: [bouncedReport()], Websites: [vulnSiteRow()] };
    const { client, captured } = captureClient();
    const result = await runDigest({
      digestState: {
        read: async () => ({}),
        write: () => Promise.reject(new Error("state write down")),
      },
      ...io(tables),
      resend: client,
      baseUrl: "https://reddoor-maintenance.netlify.app",
    });
    expect(result.code).toBe(0); // the email already went out
    expect(captured).toHaveLength(1);
    expect(warn.mock.calls.flat().join("\n")).toContain("state write down");
    warn.mockRestore();
  });

  it("shows WORSE badge when prior metric is lower than current critical+high count", async () => {
    // prior metric 1; site now has critical=2 + high=1 → total 3 → WORSE
    // (exhausted seeded true so this exercises the metric-rise path in isolation)
    const prior = JSON.stringify({
      "vuln:rec_site_acme": { metric: 1, firstFlaggedAt: "2026-06-10", exhausted: true },
    });
    const tables = {
      Reports: [],
      Websites: [vulnSiteRow({ "Security Vulns Critical": 2, "Security Vulns High": 1 })],
    };
    const { client, captured } = captureClient();
    await runDigest({
      digestState: memoryDigestState(JSON.parse(prior)),
      ...io(tables),
      resend: client,
      baseUrl: "https://reddoor-maintenance.netlify.app",
    });
    expect(captured).toHaveLength(1);
    const html = captured[0]!.html;
    expect(html).toContain("Acme Co");
    expect(html).toMatch(/\bWORSE\b/);
  });

  // ── vuln mute until Renovate auto-fix is exhausted ───────────────────────────

  it("mutes a pre-exhaustion vuln: no email (no-noise skip), but its key still snapshots", async () => {
    // Renovate has only been dispatched once — the fleet is still self-patching, so
    // the operator hears nothing. The snapshot must STILL carry the vuln key (sans
    // exhausted flag) so the cockpit's diff agrees and the later flip badges WORSE.
    const tables = {
      Reports: [],
      Websites: [vulnSiteRow({ "Security Auto-Fix Attempts": 1 })],
    };
    const { client, captured } = captureClient();
    const store = memoryDigestState();
    const result = await runDigest({
      digestState: store,
      ...io(tables),
      resend: client,
      baseUrl: "https://reddoor-maintenance.netlify.app",
    });
    expect(result.output).toMatch(/skipped/i);
    expect(captured).toHaveLength(0); // no email at all
    const snap = await store.read();
    expect(snap["vuln:rec_site_acme"]).toMatchObject({ metric: 1 });
    expect(snap["vuln:rec_site_acme"]!.exhausted).toBeUndefined();
  });

  it("a pre-exhaustion vuln does not ride along in an otherwise-sending digest", async () => {
    const tables = {
      Reports: [bouncedReport()],
      Websites: [vulnSiteRow({ "Security Auto-Fix Attempts": 0 })],
    };
    const { client, captured } = captureClient();
    await runDigest({
      digestState: memoryDigestState(),
      ...io(tables),
      resend: client,
      baseUrl: "https://reddoor-maintenance.netlify.app",
    });
    expect(captured).toHaveLength(1); // delivery failure still sends
    expect(captured[0]!.html).not.toMatch(/critical\/high vuln/);
  });

  it("the exhausted flip alone (count unchanged) surfaces the vuln badged WORSE", async () => {
    // Yesterday: muted, key snapshotted without the flag. Today: attempts hit the
    // threshold → first time the operator hears about it, escalated, not unbadged.
    const prior = JSON.stringify({
      "vuln:rec_site_acme": { metric: 1, firstFlaggedAt: "2026-06-10" },
    });
    const tables = {
      Reports: [],
      Websites: [vulnSiteRow()], // attempts 3 = exhausted, metric still 1
    };
    const { client, captured } = captureClient();
    await runDigest({
      digestState: memoryDigestState(JSON.parse(prior)),
      ...io(tables),
      resend: client,
      baseUrl: "https://reddoor-maintenance.netlify.app",
    });
    expect(captured).toHaveLength(1);
    const html = captured[0]!.html;
    expect(html).toContain("auto-fix failed");
    expect(html).toMatch(/\bWORSE\b/);
  });

  it("clears a resolved key from the snapshot even when the digest skips (no-noise)", async () => {
    // prior had a vuln; today nothing is flagged and nothing is ready → skip, but the
    // snapshot must be written back EMPTY so a later recurrence diffs as NEW (spec §10).
    const prior = JSON.stringify({
      "vuln:rec_site_acme": { metric: 1, firstFlaggedAt: "2026-06-10" },
    });
    const tables = {
      Reports: [],
      Websites: [cleanSiteRow()], // no vulns now
    };
    const { client, captured } = captureClient();
    const store = memoryDigestState(JSON.parse(prior));
    const result = await runDigest({
      digestState: store,
      ...io(tables),
      resend: client,
      baseUrl: "https://reddoor-maintenance.netlify.app",
    });
    expect(result.output).toMatch(/skipped/i);
    expect(captured).toHaveLength(0); // no email
    expect(await store.read()).toEqual({}); // resolved key cleared
  });

  // ── Submissions (24h) telemetry ──────────────────────────────────────────────

  it("renders injected submissionCounts as the Submissions (24h) section, names resolved", async () => {
    const tables = { Reports: [readyReport()], Websites: [siteRow()] };
    const { client, captured } = captureClient();
    const counts = new Map<string, SiteSubmissionCounts>([
      ["rec_site_acme", { leads: 2, signups: 1, spamAuto: 3 }],
    ]);
    const result = await runDigest({
      digestState: memoryDigestState(),
      ...io(tables),
      resend: client,
      baseUrl: "https://reddoor-maintenance.netlify.app",
      submissionCounts: counts,
    });
    expect(result.code).toBe(0);
    const html = captured[0]!.html;
    expect(html).toContain("Submissions (24h)");
    expect(html).toContain("2 new leads · 1 newsletter/RSVP signup · 3 auto-filtered spam");
    expect(html).toContain("2 leads · 1 signup · 3 auto-filtered");
  });

  it("submissionCounts: null (libSQL unavailable) still sends the digest WITHOUT the section", async () => {
    const tables = { Reports: [readyReport()], Websites: [siteRow()] };
    const { client, captured } = captureClient();
    const result = await runDigest({
      digestState: memoryDigestState(),
      ...io(tables),
      resend: client,
      baseUrl: "https://reddoor-maintenance.netlify.app",
      submissionCounts: null,
    });
    expect(result.code).toBe(0);
    expect(captured).toHaveLength(1);
    expect(captured[0]!.html).not.toContain("Submissions (24h)");
  });

  it("telemetry alone NEVER flips a skip into a send (no-noise rule unchanged)", async () => {
    // Nothing pending, nothing needing attention — nonzero injected counts must not
    // trigger a send (leads already fire their own ingest-time notification).
    const tables = { Reports: [], Websites: [cleanSiteRow()] };
    const { client, captured } = captureClient();
    const result = await runDigest({
      digestState: memoryDigestState(),
      ...io(tables),
      resend: client,
      baseUrl: "https://reddoor-maintenance.netlify.app",
      submissionCounts: new Map([["rec_site_acme", { leads: 5, signups: 5, spamAuto: 5 }]]),
    });
    expect(result.code).toBe(0);
    expect(result.output).toContain("skipped");
    expect(captured).toHaveLength(0);
  });
});

// ── buildSubmissionsDigestSection (pure assembler) ────────────────────────────

describe("buildSubmissionsDigestSection", () => {
  const sitesById = new Map([
    ["recA", makeWebsiteRow({ id: "recA", name: "Alpha" })],
    ["recB", makeWebsiteRow({ id: "recB", name: "Beta" })],
  ]);

  it("returns null when counts are null (libSQL unavailable)", () => {
    expect(buildSubmissionsDigestSection(null, sitesById)).toBeNull();
  });

  it("counts an orphan site id in the fleet totals but omits it from bySite", () => {
    const counts = new Map<string, SiteSubmissionCounts>([
      ["recA", { leads: 1, signups: 0, spamAuto: 0 }],
      ["recGHOST", { leads: 2, signups: 1, spamAuto: 1 }],
    ]);
    const s = buildSubmissionsDigestSection(counts, sitesById);
    expect(s).toEqual({
      leads: 3,
      signups: 1,
      spamAuto: 1,
      bySite: [{ siteName: "Alpha", leads: 1, signups: 0, spamAuto: 0 }],
    });
  });

  it("drops all-zero sites from bySite and sorts by volume desc then name A-Z", () => {
    const counts = new Map<string, SiteSubmissionCounts>([
      ["recA", { leads: 1, signups: 0, spamAuto: 0 }],
      ["recB", { leads: 0, signups: 0, spamAuto: 0 }],
    ]);
    const s = buildSubmissionsDigestSection(counts, sitesById)!;
    expect(s.bySite.map((x) => x.siteName)).toEqual(["Alpha"]);

    const tie = new Map<string, SiteSubmissionCounts>([
      ["recB", { leads: 1, signups: 0, spamAuto: 0 }],
      ["recA", { leads: 1, signups: 0, spamAuto: 0 }],
    ]);
    expect(buildSubmissionsDigestSection(tie, sitesById)!.bySite.map((x) => x.siteName)).toEqual([
      "Alpha",
      "Beta",
    ]);

    const volume = new Map<string, SiteSubmissionCounts>([
      ["recA", { leads: 1, signups: 0, spamAuto: 0 }],
      ["recB", { leads: 1, signups: 2, spamAuto: 3 }],
    ]);
    expect(buildSubmissionsDigestSection(volume, sitesById)!.bySite.map((x) => x.siteName)).toEqual(
      ["Beta", "Alpha"],
    );
  });
});

describe("runDigest — sends only on change, with ages and exact asks (P1-20)", () => {
  const BASE = "https://reddoor-maintenance.netlify.app";

  function memorySendLog(seed?: DigestSendLog) {
    let log: DigestSendLog = seed ?? { sentOn: null, sent: {}, readySince: {} };
    return {
      read: async () => log,
      write: async (next: DigestSendLog) => {
        log = next;
      },
      get: () => log,
    };
  }

  function day(n: number): Date {
    return new Date(Date.UTC(2026, 8, 18 + n, 13, 0, 0));
  }

  function world() {
    return {
      digestState: memoryDigestState(),
      sendLog: memorySendLog(),
      ...captureClient(),
    };
  }

  async function run(
    w: ReturnType<typeof world>,
    tables: { Websites: RawRow[]; Reports: RawRow[] },
    now: Date,
  ) {
    return runDigest({
      digestState: w.digestState,
      sendLog: w.sendLog,
      ...io(tables),
      resend: w.client,
      baseUrl: BASE,
      now,
    });
  }

  const navy = {
    Reports: [readyReport(), approvedReport()],
    Websites: [siteRow({ Name: "29 Navy", "point of contact": undefined })],
  };

  it("sends on the first day, then stays quiet while nothing changes", async () => {
    const w = world();
    const first = await run(w, navy, day(0));
    expect(first.output).toContain("Digest sent (first)");
    expect(w.captured).toHaveLength(1);
    for (let n = 1; n <= 6; n++) {
      const r = await run(w, navy, day(n));
      expect(r.code).toBe(0);
      expect(r.output).toContain("Digest skipped (unchanged since 2026-09-18");
    }
    expect(w.captured).toHaveLength(1);
    expect(w.sendLog.get().sentOn).toBe("2026-09-18");
  });

  it("sends a weekly heartbeat for an unchanged set, carrying each item's age", async () => {
    const w = world();
    await run(w, navy, day(0));
    for (let n = 1; n <= 6; n++) await run(w, navy, day(n));
    const r = await run(w, navy, day(7));
    expect(r.output).toContain("Digest sent (heartbeat)");
    expect(w.captured).toHaveLength(2);
    const html = w.captured[1]!.html;
    expect(html).toContain("(waiting 7 days)");
    expect(html).toContain("(7 days)");
    expect(html).toContain("set Report recipients (To) on /s/29-navy, then");
  });

  it("sends when the set changes, and a repeated item reads its age", async () => {
    const w = world();
    await run(w, navy, day(0));
    await run(w, navy, day(1));
    const changed = {
      Reports: [...navy.Reports, bouncedReport()],
      Websites: navy.Websites,
    };
    const r = await run(w, changed, day(3));
    expect(r.output).toContain("Digest sent (added)");
    const html = w.captured[1]!.html;
    expect(html).toContain("(3 days)");
    expect(html).toContain("(waiting 3 days)");
    expect(html).toMatch(/NEW<\/strong> <a [^>]*>A sent report bounced<\/a>(?! <span)/);
  });

  it("a resolution alone sends nothing; it rides the next send", async () => {
    const w = world();
    await run(w, navy, day(0));
    const fewer = { Reports: [readyReport()], Websites: navy.Websites };
    const r = await run(w, fewer, day(1));
    expect(r.output).toContain("Digest skipped (unchanged since 2026-09-18");
    expect(w.captured).toHaveLength(1);
  });

  it("an item already sent that leaves and comes back is news again, as a new one is", async () => {
    const w = world();
    await run(w, navy, day(0));
    await run(w, { Reports: [], Websites: navy.Websites }, day(1));
    const back = await run(w, navy, day(2));
    expect(back.output).toContain("Digest sent (added)");
    await run(w, navy, day(3));
    const added = await run(
      w,
      { Reports: [...navy.Reports, bouncedReport()], Websites: navy.Websites },
      day(4),
    );
    expect(added.output).toContain("Digest sent (added)");
    expect(w.captured).toHaveLength(3);
  });

  it("a skip still writes the attention snapshot, so a resolved key drops out of it", async () => {
    const w = world();
    const withBounce = {
      Reports: [...navy.Reports, bouncedReport()],
      Websites: navy.Websites,
    };
    await run(w, withBounce, day(0));
    expect(Object.keys(await w.digestState.read())).toContain("delivery:rec_report_bounced");
    const r = await run(w, navy, day(1));
    expect(r.output).toContain("Digest skipped (unchanged");
    expect(Object.keys(await w.digestState.read())).not.toContain("delivery:rec_report_bounced");
  });

  it("fails open: an unreadable send log sends, as before P1-20", async () => {
    const w = world();
    const broken = {
      read: async (): Promise<DigestSendLog> => {
        throw new Error("turso down");
      },
      write: async () => {},
    };
    for (const n of [0, 1]) {
      await runDigest({
        digestState: w.digestState,
        sendLog: broken,
        ...io(navy),
        resend: w.client,
        baseUrl: BASE,
        now: day(n),
      });
    }
    expect(w.captured).toHaveLength(2);
  });

  it("prints the send-log marker the workflow gates on, 0 when the write throws", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const w = world();
    await run(w, navy, day(0));
    await run(w, navy, day(1));
    await runDigest({
      digestState: w.digestState,
      sendLog: {
        read: w.sendLog.read,
        write: async () => {
          throw new Error("turso down");
        },
      },
      ...io(navy),
      resend: w.client,
      baseUrl: BASE,
      now: day(2),
    });
    const lines = log.mock.calls
      .map((c) => String(c[0]))
      .filter((l) => l.startsWith("DIGEST_SEND_LOG"));
    log.mockRestore();
    expect(lines).toEqual([
      "DIGEST_SEND_LOG write=1 decision=first",
      "DIGEST_SEND_LOG write=1 decision=unchanged",
      "DIGEST_SEND_LOG write=0 decision=unchanged",
    ]);
  });
});

describe("runDigest — the round-2 rule: prune every run, high-water per key, health by field (P1-20)", () => {
  const BASE = "https://reddoor-maintenance.netlify.app";

  function memorySendLog() {
    let log: DigestSendLog = { sentOn: null, sent: {}, readySince: {} };
    return {
      read: async () => log,
      write: async (next: DigestSendLog) => {
        log = next;
      },
      get: () => log,
    };
  }

  function day(n: number): Date {
    return new Date(Date.UTC(2026, 9, 1 + n, 13, 0, 0));
  }

  function world() {
    return { digestState: memoryDigestState(), sendLog: memorySendLog(), ...captureClient() };
  }

  async function run(
    w: ReturnType<typeof world>,
    tables: { Websites: RawRow[]; Reports: RawRow[] },
    now: Date,
  ): Promise<string> {
    const r = await runDigest({
      digestState: w.digestState,
      sendLog: w.sendLog,
      ...io(tables),
      resend: w.client,
      baseUrl: BASE,
      now,
    });
    expect(r.code).toBe(0);
    return r.output;
  }

  const verdict = (output: string): string =>
    output.match(/^Digest sent \(([a-z-]+)\)/)?.[1] ??
    (output.startsWith("Digest skipped (nothing") ? "empty" : "skip");

  const navySite = siteRow({ Name: "29 Navy", "point of contact": undefined });
  const bounceOnly = { Websites: [navySite], Reports: [bouncedReport()] };
  const nothing = { Websites: [navySite], Reports: [] };

  it("a fixed item that recurs after empty days sends on the day it comes back (round 2, major 1)", async () => {
    const w = world();
    const plan = [bounceOnly, nothing, nothing, bounceOnly, bounceOnly, bounceOnly, bounceOnly];
    const seen: string[] = [];
    for (const [n, tables] of plan.entries()) seen.push(verdict(await run(w, tables, day(n))));
    expect(seen).toEqual(["first", "empty", "empty", "added", "skip", "skip", "skip"]);
  });

  it("a fixed item that recurs after skipped days sends on the day it comes back", async () => {
    const w = world();
    const navy = { Websites: [navySite], Reports: [readyReport()] };
    const withBounce = { Websites: [navySite], Reports: [readyReport(), bouncedReport()] };
    const plan = [withBounce, navy, navy, withBounce, withBounce];
    const seen: string[] = [];
    for (const [n, tables] of plan.entries()) seen.push(verdict(await run(w, tables, day(n))));
    expect(seen).toEqual(["first", "skip", "skip", "added", "skip"]);
  });

  it("a blocked draft whose ask regains a part sends; losing one does not", async () => {
    const w = world();
    const noHeader = siteRow({
      Name: "29 Navy",
      "point of contact": undefined,
      "Header image": undefined,
    });
    const both = { Websites: [noHeader], Reports: [readyReport()] };
    const one = { Websites: [navySite], Reports: [readyReport()] };
    const seen: string[] = [];
    for (const [n, tables] of [both, one, one, both].entries()) {
      seen.push(verdict(await run(w, tables, day(n))));
    }
    expect(seen).toEqual(["first", "skip", "skip", "new-ask"]);
  });

  it("a health field flipping between failing and unknown is not a new ask (round 2, minor)", async () => {
    const w = world();
    const evidence = (cms: "fail" | null) => {
      const e = JSON.parse(healthCleanEvidence()) as Record<string, unknown>;
      if (cms) e["Maint: CMS Checked"] = { result: cms, checkedAt: "2026-09-30", note: "500" };
      else delete e["Maint: CMS Checked"];
      return JSON.stringify(e);
    };
    const tables = (cms: "fail" | null) => ({
      Websites: [siteRow({ Name: "29 Navy" })],
      Reports: [readyReport({ "Checklist auto-evidence": evidence(cms) })],
    });
    const seen: string[] = [];
    for (const [n, cms] of (["fail", null, "fail", null, "fail"] as const).entries()) {
      seen.push(verdict(await run(w, tables(cms), day(n))));
    }
    expect(seen).toEqual(["first", "skip", "skip", "skip", "skip"]);
  });

  function mulberry32(seed: number): () => number {
    let a = seed;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const lighthouseFleet = (scores: number[]) => ({
    Websites: scores
      .map((pScore, i) => siteRow({ Name: `Jitter ${i}`, pScore }))
      .map((row, i) => ({ ...row, id: `rec_site_jitter_${i}` })),
    Reports: [],
  });

  it("six Lighthouse items jittering 30–34 after a send at 30 send only day 1 and weekly heartbeats (round 2, major 2)", async () => {
    const rand = mulberry32(975);
    const w = world();
    const sends: number[] = [];
    for (let n = 0; n < 28; n++) {
      const scores = Array.from({ length: 6 }, () => (n === 0 ? 30 : 30 + Math.floor(rand() * 5)));
      const v = verdict(await run(w, lighthouseFleet(scores), day(n)));
      if (v !== "skip") sends.push(n);
    }
    expect(sends).toEqual([0, 7, 14, 21]);
    expect(w.captured).toHaveLength(4);
  });

  it("under free jitter, every 'worse' send is a genuine new high and every new high sends", async () => {
    for (const seed of [1, 2, 3, 975]) {
      const rand = mulberry32(seed);
      const w = world();
      const high: number[] = [];
      for (let n = 0; n < 28; n++) {
        const metrics = Array.from({ length: 6 }, () => 66 + Math.floor(rand() * 5));
        const record = n > 0 && metrics.some((m, i) => m > high[i]!);
        metrics.forEach((m, i) => (high[i] = Math.max(high[i] ?? m, m)));
        const v = verdict(await run(w, lighthouseFleet(metrics.map((m) => 100 - m)), day(n)));
        if (record) expect(v, `seed ${seed} day ${n}`).toBe("worse");
        else expect(["first", "heartbeat", "skip"], `seed ${seed} day ${n}`).toContain(v);
      }
    }
  });
});

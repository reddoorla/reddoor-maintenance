import { describe, it, expect, beforeEach, vi } from "vitest";
import { runDigest, listPendingApproval } from "../../src/reports/digest.js";
import type { ResendClient, ResendSendInput } from "../../src/reports/send/resend.js";
import { makeFakeBase, type FakeRecord } from "./_helpers/fake-airtable-base.js";

// The vi.mock is kept narrowly for the ONE env-config-path test below.
// All other runDigest tests use direct base injection via DigestRunOptions.base.
vi.mock("../../src/reports/airtable/client.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/reports/airtable/client.js")>(
    "../../src/reports/airtable/client.js",
  );
  return {
    ...actual,
    openBase: vi.fn(),
  };
});

import { openBase } from "../../src/reports/airtable/client.js";

beforeEach(() => {
  process.env.AIRTABLE_PAT = "pat_test";
  process.env.AIRTABLE_BASE_ID = "app_test";
  process.env.OPERATOR_EMAIL = "tucker@reddoorla.com";
});

// ── seed helpers ────────────────────────────────────────────────────────────

function siteRow(over: Partial<FakeRecord["fields"]> = {}): FakeRecord {
  return {
    id: "rec_site_acme",
    fields: {
      Name: "Acme Co",
      url: "https://acme.example.com",
      ...over,
    },
  };
}

/** A report that IS pending approval: draftReady=true, approvedToSend=false, sentAt=null. */
function readyReport(over: Partial<FakeRecord["fields"]> = {}): FakeRecord {
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
      ...over,
    },
  };
}

/** A report that is already approved — must be EXCLUDED by listPendingApproval. */
function approvedReport(over: Partial<FakeRecord["fields"]> = {}): FakeRecord {
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

/** A report that was already sent — must be EXCLUDED by listPendingApproval. */
function sentReport(over: Partial<FakeRecord["fields"]> = {}): FakeRecord {
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

/** A report where draft is not ready — must be EXCLUDED by listPendingApproval. */
function unreadyReport(over: Partial<FakeRecord["fields"]> = {}): FakeRecord {
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

/** A site carrying a critical vuln — collectVulnAlerts flags it. */
function vulnSiteRow(over: Partial<FakeRecord["fields"]> = {}): FakeRecord {
  return {
    id: "rec_site_acme",
    fields: {
      Name: "Acme Co",
      url: "https://acme.example.com",
      "Security Vulns Critical": 1,
      ...over,
    },
  };
}

/** A vulnSiteRow with critical+high both 0 — collectVulnAlerts skips it. */
function cleanSiteRow(over: Partial<FakeRecord["fields"]> = {}): FakeRecord {
  return vulnSiteRow({
    "Security Vulns Critical": 0,
    "Security Vulns High": 0,
    ...over,
  });
}

/** A bounced report — collectDeliveryFailures flags it. */
function bouncedReport(over: Partial<FakeRecord["fields"]> = {}): FakeRecord {
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

// ── listPendingApproval ──────────────────────────────────────────────────────

describe("listPendingApproval", () => {
  it("returns only draftReady=true, approvedToSend=false, sentAt=null rows", async () => {
    const base = makeFakeBase({
      Reports: [readyReport(), approvedReport(), sentReport(), unreadyReport()],
    });
    const rows = await listPendingApproval(base);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe("rec_report_ready");
  });

  it("returns empty array when no reports match", async () => {
    const base = makeFakeBase({
      Reports: [approvedReport(), sentReport(), unreadyReport()],
    });
    const rows = await listPendingApproval(base);
    expect(rows).toHaveLength(0);
  });

  it("does NOT return an approved report", async () => {
    const base = makeFakeBase({ Reports: [approvedReport()] });
    const rows = await listPendingApproval(base);
    expect(rows.every((r) => !r.approvedToSend)).toBe(true);
  });

  it("does NOT return a sent report", async () => {
    const base = makeFakeBase({ Reports: [sentReport()] });
    const rows = await listPendingApproval(base);
    expect(rows.every((r) => r.sentAt === null)).toBe(true);
  });

  it("does NOT return an unready report", async () => {
    const base = makeFakeBase({ Reports: [unreadyReport()] });
    const rows = await listPendingApproval(base);
    expect(rows.every((r) => r.draftReady)).toBe(true);
  });
});

// ── runDigest ────────────────────────────────────────────────────────────────

describe("runDigest", () => {
  // ── env-config path (one test kept to cover openBase(readAirtableConfig())) ──

  it("uses openBase(readAirtableConfig()) when no base is injected", async () => {
    const fakeBase = makeFakeBase({ Reports: [], Websites: [] });
    vi.mocked(openBase).mockReturnValue(fakeBase);
    // Call without the `base` option — must reach the env-config branch
    const result = await runDigest({ baseUrl: "https://reddoor-maintenance.netlify.app" });
    expect(vi.mocked(openBase)).toHaveBeenCalled();
    expect(result.code).toBe(0);
  });

  // ── direct injection (all other tests) ─────────────────────────────────────

  it("skips when there is nothing pending and nothing needing attention", async () => {
    const base = makeFakeBase({ Reports: [], Websites: [] });
    const result = await runDigest({ base, baseUrl: "https://reddoor-maintenance.netlify.app" });
    expect(result.code).toBe(0);
    expect(result.output).toContain("skipped");
  });

  it("skips when only non-pending reports exist (all approved/sent/unready)", async () => {
    const base = makeFakeBase({
      Reports: [approvedReport(), sentReport(), unreadyReport()],
      Websites: [siteRow()],
    });
    const result = await runDigest({ base, baseUrl: "https://reddoor-maintenance.netlify.app" });
    expect(result.code).toBe(0);
    expect(result.output).toContain("skipped");
  });

  it("sends a digest when a ready report exists", async () => {
    const base = makeFakeBase({ Reports: [readyReport()], Websites: [siteRow()] });
    const { client, captured } = captureClient();
    const result = await runDigest({
      base,
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
    const base = makeFakeBase({
      Reports: [readyReport()],
      Websites: [siteRow({ Name: "!!!" })],
    });
    const { client, captured } = captureClient();
    await runDigest({
      base,
      resend: client,
      baseUrl: "https://reddoor-maintenance.netlify.app",
    });
    const html = captured[0]!.html;
    expect(html).toContain('href="https://reddoor-maintenance.netlify.app"');
    expect(html).not.toContain("/s/"); // no malformed empty-slug link
  });

  it("subject is dated and uses correct singular form for 1 report", async () => {
    const base = makeFakeBase({ Reports: [readyReport()], Websites: [siteRow()] });
    const { client, captured } = captureClient();
    await runDigest({
      base,
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
    const site2: FakeRecord = {
      id: "rec_site_beta",
      fields: { Name: "Beta Ltd", url: "https://beta.example.com" },
    };
    const report2 = readyReport({
      "Report ID": "Beta Ltd — Maintenance — 2026-06",
      Site: ["rec_site_beta"],
      Period: "2026-06",
    });
    report2.id = "rec_report_ready_2";
    const base = makeFakeBase({
      Reports: [readyReport(), report2],
      Websites: [siteRow(), site2],
    });
    const { client, captured } = captureClient();
    await runDigest({
      base,
      resend: client,
      baseUrl: "https://reddoor-maintenance.netlify.app",
    });
    // Expected: "Your fleet — YYYY-MM-DD: 2 reports ready for your yes"
    expect(captured[0]!.subject).toMatch(
      /^Your fleet — \d{4}-\d{2}-\d{2}: 2 reports ready for your yes$/,
    );
  });

  it("includes the correct dashboard URL for the site", async () => {
    const base = makeFakeBase({ Reports: [readyReport()], Websites: [siteRow()] });
    const { client, captured } = captureClient();
    await runDigest({
      base,
      resend: client,
      baseUrl: "https://reddoor-maintenance.netlify.app",
    });
    expect(captured[0]!.html).toContain("/s/acme-co");
  });

  it("strips trailing slash from baseUrl before building dashboard links", async () => {
    const base = makeFakeBase({ Reports: [readyReport()], Websites: [siteRow()] });
    const { client, captured } = captureClient();
    await runDigest({
      base,
      resend: client,
      baseUrl: "https://reddoor-maintenance.netlify.app/",
    });
    // Must not produce double slashes like /s//acme-co
    expect(captured[0]!.html).not.toContain("//s/");
    expect(captured[0]!.html).toContain("/s/acme-co");
  });

  it("skips orphan reports whose site row is missing", async () => {
    // Report points at rec_site_acme but Websites table is empty
    const base = makeFakeBase({ Reports: [readyReport()], Websites: [] });
    const result = await runDigest({ base, baseUrl: "https://reddoor-maintenance.netlify.app" });
    // No site → no ReadyItems → skipped
    expect(result.code).toBe(0);
    expect(result.output).toContain("skipped");
  });

  it("returns the Resend message id in the output string", async () => {
    const base = makeFakeBase({ Reports: [readyReport()], Websites: [siteRow()] });
    const { client } = captureClient();
    const result = await runDigest({
      base,
      resend: client,
      baseUrl: "https://reddoor-maintenance.netlify.app",
    });
    expect(result.output).toContain("msg_1");
  });

  it("falls back to the constant when OPERATOR_EMAIL is unset", async () => {
    delete process.env.OPERATOR_EMAIL;
    const base = makeFakeBase({ Reports: [readyReport()], Websites: [siteRow()] });
    const { client, captured } = captureClient();
    await runDigest({ base, resend: client, baseUrl: "https://reddoor-maintenance.netlify.app" });
    expect(captured[0]!.to).toEqual(["info@reddoorla.com"]);
  });

  // ── error contract ──────────────────────────────────────────────────────────

  it("returns code 1 and a tidy message when resend.send rejects", async () => {
    const base = makeFakeBase({ Reports: [readyReport()], Websites: [siteRow()] });
    const result = await runDigest({
      base,
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
    const base = makeFakeBase({ Reports: [readyReport()], Websites: [siteRow()] });
    const result = await runDigest({
      base,
      resend: idempotencyConflictClient(),
      baseUrl: "https://reddoor-maintenance.netlify.app",
    });
    expect(result.code).toBe(0);
    expect(result.output).toMatch(/already sent today/i);
  });

  it("does NOT write the Digest State snapshot on an idempotency-conflict skip", async () => {
    // The FIRST send already persisted the snapshot; writing this run's `next` would
    // diff against the first run's snapshot and mis-badge. No state write must occur.
    const base = makeFakeBase({ Reports: [bouncedReport()], Websites: [vulnSiteRow()] });
    const result = await runDigest({
      base,
      resend: idempotencyConflictClient(),
      baseUrl: "https://reddoor-maintenance.netlify.app",
    });
    expect(result.code).toBe(0);
    const stateWrites = base.__calls.filter(
      (c) => c.table === "Digest State" && (c.kind === "create" || c.kind === "update"),
    );
    expect(stateWrites).toHaveLength(0);
  });

  it("a GENERIC send error still propagates to code 1 (must fail loudly, not skip)", async () => {
    // A real Resend/network failure (no idempotency-key wording) must NOT be swallowed
    // as a skip — it still falls through to the outer catch → {code:1}.
    const base = makeFakeBase({ Reports: [readyReport()], Websites: [siteRow()] });
    const result = await runDigest({
      base,
      resend: rejectClient("Resend 500"),
      baseUrl: "https://reddoor-maintenance.netlify.app",
    });
    expect(result.code).toBe(1);
    expect(result.output).toBe("digest failed: Resend 500");
  });

  // ── exitCode passthrough ────────────────────────────────────────────────────

  it("re-throws errors that carry a numeric exitCode property (config errors propagate)", async () => {
    const configError = Object.assign(new Error("missing RESEND_API_KEY"), { exitCode: 2 });
    const base = makeFakeBase({ Reports: [readyReport()], Websites: [siteRow()] });
    const badClient: ResendClient = {
      async send() {
        throw configError;
      },
    };
    await expect(
      runDigest({ base, resend: badClient, baseUrl: "https://reddoor-maintenance.netlify.app" }),
    ).rejects.toThrow("missing RESEND_API_KEY");
  });

  it("returns {code:1} for a plain Error with no exitCode (runtime errors are swallowed)", async () => {
    const base = makeFakeBase({ Reports: [readyReport()], Websites: [siteRow()] });
    const result = await runDigest({
      base,
      resend: rejectClient("network error"),
      baseUrl: "https://reddoor-maintenance.netlify.app",
    });
    expect(result.code).toBe(1);
    expect(result.output).toBe("digest failed: network error");
  });

  it("returns code 1 and a tidy message when listWebsites rejects", async () => {
    // Poison the base so that any call to the Websites table's select.eachPage throws.
    // listWebsites calls: base("Websites").select(...).eachPage(cb)
    // The AirtableBase type is a callable (table-name → table API), so we wrap it.
    const goodBase = makeFakeBase({ Reports: [readyReport()], Websites: [siteRow()] });
    const poisonedBase = new Proxy(goodBase, {
      apply(_target, _this, [name]: [string]) {
        const tbl = goodBase(name);
        if (name === "Websites") {
          return {
            ...tbl,
            select: () => ({
              eachPage: async () => {
                throw new Error("airtable down");
              },
            }),
          };
        }
        return tbl;
      },
    });
    const { client } = captureClient();
    const result = await runDigest({
      base: poisonedBase as unknown as typeof goodBase,
      resend: client,
      baseUrl: "https://reddoor-maintenance.netlify.app",
    });
    expect(result.code).toBe(1);
    expect(result.output).toMatch(/^digest failed: /);
  });

  // ── fetch dedup ────────────────────────────────────────────────────────────

  it("fetches Websites once and Reports once for the whole run (no duplicate reads)", async () => {
    // A ready report + a vuln site → the full path runs: ready-list, attention
    // collect, and state read all execute. Reports/Websites must each be SELECTed
    // exactly once across the entire run.
    const base = makeFakeBase({ Reports: [readyReport()], Websites: [vulnSiteRow()] });
    const { client } = captureClient();
    await runDigest({ base, resend: client, baseUrl: "https://reddoor-maintenance.netlify.app" });

    const websiteSelects = base.__calls.filter(
      (c) => c.kind === "select" && c.table === "Websites",
    );
    const reportSelects = base.__calls.filter((c) => c.kind === "select" && c.table === "Reports");
    expect(websiteSelects).toHaveLength(1);
    expect(reportSelects).toHaveLength(1);
  });

  // ── attention wiring ─────────────────────────────────────────────────────────

  it("surfaces a vuln + a delivery item, both NEW, on the first run (no prior state)", async () => {
    const base = makeFakeBase({
      Reports: [bouncedReport()],
      Websites: [vulnSiteRow()],
      // "Digest State" absent → readDigestState returns {} → everything NEW
    });
    const { client, captured } = captureClient();
    const result = await runDigest({
      base,
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
    const base = makeFakeBase({ Reports: [], Websites: [vulnSiteRow()] });
    const { client, captured } = captureClient();
    const result = await runDigest({
      base,
      resend: client,
      baseUrl: "https://reddoor-maintenance.netlify.app",
    });
    expect(result.code).toBe(0);
    expect(captured).toHaveLength(1);
    expect(captured[0]!.html).toContain("Acme Co");
  });

  it("writes the next snapshot to Digest State after sending", async () => {
    const base = makeFakeBase({ Reports: [bouncedReport()], Websites: [vulnSiteRow()] });
    const { client } = captureClient();
    await runDigest({ base, resend: client, baseUrl: "https://reddoor-maintenance.netlify.app" });
    // A create OR update against "Digest State" must have happened (singleton get-or-create).
    const stateWrites = base.__calls.filter(
      (c) => c.table === "Digest State" && (c.kind === "create" || c.kind === "update"),
    );
    expect(stateWrites.length).toBeGreaterThanOrEqual(1);
    const row = base.__records.get("Digest State")!.at(-1)!;
    const snap = JSON.parse(String(row.fields["Snapshot"]));
    expect(snap["vuln:rec_site_acme"]).toBeDefined();
    expect(snap["delivery:rec_report_bounced"]).toBeDefined();
  });

  it("second run with prior state seeded shows STANDING (no NEW/WORSE badge)", async () => {
    const prior = JSON.stringify({
      "vuln:rec_site_acme": { metric: 1, firstFlaggedAt: "2026-06-10" },
      "delivery:rec_report_bounced": { metric: 1, firstFlaggedAt: "2026-06-10" },
    });
    const base = makeFakeBase({
      Reports: [bouncedReport()],
      Websites: [vulnSiteRow()],
      "Digest State": [{ id: "rec_state", fields: { Snapshot: prior } }],
    });
    const { client, captured } = captureClient();
    await runDigest({ base, resend: client, baseUrl: "https://reddoor-maintenance.netlify.app" });
    const html = captured[0]!.html;
    expect(html).toContain("Acme Co"); // standing problem still rendered
    expect(html).not.toMatch(/\bNEW\b/);
    expect(html).not.toMatch(/\bWORSE\b/);
  });

  it("a state write failure is caught and logged; the run still reports success", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const good = makeFakeBase({ Reports: [bouncedReport()], Websites: [vulnSiteRow()] });
    // Poison only the "Digest State" writes (create+update both throw).
    const poisoned = new Proxy(good, {
      apply(_t, _this, [name]: [string]) {
        const tbl = good(name);
        if (name === "Digest State") {
          return {
            ...tbl,
            create: async () => {
              throw new Error("state write down");
            },
            update: async () => {
              throw new Error("state write down");
            },
          };
        }
        return tbl;
      },
    });
    const { client, captured } = captureClient();
    const result = await runDigest({
      base: poisoned as unknown as typeof good,
      resend: client,
      baseUrl: "https://reddoor-maintenance.netlify.app",
    });
    expect(result.code).toBe(0); // the email already went out
    expect(captured).toHaveLength(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("shows WORSE badge when prior metric is lower than current critical+high count", async () => {
    // prior metric 1; site now has critical=2 + high=1 → total 3 → WORSE
    const prior = JSON.stringify({
      "vuln:rec_site_acme": { metric: 1, firstFlaggedAt: "2026-06-10" },
    });
    const base = makeFakeBase({
      Reports: [],
      Websites: [vulnSiteRow({ "Security Vulns Critical": 2, "Security Vulns High": 1 })],
      "Digest State": [{ id: "rec_state", fields: { Snapshot: prior } }],
    });
    const { client, captured } = captureClient();
    await runDigest({ base, resend: client, baseUrl: "https://reddoor-maintenance.netlify.app" });
    expect(captured).toHaveLength(1);
    const html = captured[0]!.html;
    expect(html).toContain("Acme Co");
    expect(html).toMatch(/\bWORSE\b/);
  });

  it("clears a resolved key from the snapshot even when the digest skips (no-noise)", async () => {
    // prior had a vuln; today nothing is flagged and nothing is ready → skip, but the
    // snapshot must be written back EMPTY so a later recurrence diffs as NEW (spec §10).
    const prior = JSON.stringify({
      "vuln:rec_site_acme": { metric: 1, firstFlaggedAt: "2026-06-10" },
    });
    const base = makeFakeBase({
      Reports: [],
      Websites: [cleanSiteRow()], // no vulns now
      "Digest State": [{ id: "rec_state", fields: { Snapshot: prior } }],
    });
    const { client, captured } = captureClient();
    const result = await runDigest({
      base,
      resend: client,
      baseUrl: "https://reddoor-maintenance.netlify.app",
    });
    expect(result.output).toMatch(/skipped/i);
    expect(captured).toHaveLength(0); // no email
    const row = base.__records.get("Digest State")!.at(-1)!;
    expect(JSON.parse(String(row.fields["Snapshot"]))).toEqual({}); // resolved key cleared
  });
});

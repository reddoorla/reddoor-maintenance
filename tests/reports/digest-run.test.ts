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
});

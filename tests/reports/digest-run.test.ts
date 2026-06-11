import { describe, it, expect, beforeEach, vi } from "vitest";
import { runDigest, listPendingApproval } from "../../src/reports/digest.js";
import type { ResendClient, ResendSendInput } from "../../src/reports/send/resend.js";
import { makeFakeBase, type FakeRecord } from "./_helpers/fake-airtable-base.js";

// Helper: openBase reads from env; tests need to inject a fake. Patch via vi.mock.
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
  it("skips when there is nothing pending and nothing needing attention", async () => {
    vi.mocked(openBase).mockReturnValue(makeFakeBase({ Reports: [], Websites: [] }));
    const result = await runDigest({ baseUrl: "https://reddoor-maintenance.netlify.app" });
    expect(result.code).toBe(0);
    expect(result.output).toContain("skipped");
  });

  it("skips when only non-pending reports exist (all approved/sent/unready)", async () => {
    vi.mocked(openBase).mockReturnValue(
      makeFakeBase({
        Reports: [approvedReport(), sentReport(), unreadyReport()],
        Websites: [siteRow()],
      }),
    );
    const result = await runDigest({ baseUrl: "https://reddoor-maintenance.netlify.app" });
    expect(result.code).toBe(0);
    expect(result.output).toContain("skipped");
  });

  it("sends a digest when a ready report exists", async () => {
    vi.mocked(openBase).mockReturnValue(
      makeFakeBase({ Reports: [readyReport()], Websites: [siteRow()] }),
    );
    const { client, captured } = captureClient();
    const result = await runDigest({
      resend: client,
      baseUrl: "https://reddoor-maintenance.netlify.app",
    });
    expect(result.code).toBe(0);
    expect(captured).toHaveLength(1);
    const sent = captured[0]!;
    expect(sent.from).toBe("Reddoor Reports <reports@reddoorla.com>");
    expect(sent.to).toEqual(["tucker@reddoorla.com"]);
    expect(sent.subject).toContain("1 ready");
    expect(sent.idempotencyKey).toMatch(/^digest-\d{4}-\d{2}-\d{2}$/);
    expect(sent.html).toContain("Acme Co");
  });

  it("includes the correct dashboard URL for the site", async () => {
    vi.mocked(openBase).mockReturnValue(
      makeFakeBase({ Reports: [readyReport()], Websites: [siteRow()] }),
    );
    const { client, captured } = captureClient();
    await runDigest({
      resend: client,
      baseUrl: "https://reddoor-maintenance.netlify.app",
    });
    expect(captured[0]!.html).toContain("/s/acme-co");
  });

  it("strips trailing slash from baseUrl before building dashboard links", async () => {
    vi.mocked(openBase).mockReturnValue(
      makeFakeBase({ Reports: [readyReport()], Websites: [siteRow()] }),
    );
    const { client, captured } = captureClient();
    await runDigest({
      resend: client,
      baseUrl: "https://reddoor-maintenance.netlify.app/",
    });
    // Must not produce double slashes like /s//acme-co
    expect(captured[0]!.html).not.toContain("//s/");
    expect(captured[0]!.html).toContain("/s/acme-co");
  });

  it("skips orphan reports whose site row is missing", async () => {
    // Report points at rec_site_acme but Websites table is empty
    vi.mocked(openBase).mockReturnValue(makeFakeBase({ Reports: [readyReport()], Websites: [] }));
    const result = await runDigest({ baseUrl: "https://reddoor-maintenance.netlify.app" });
    // No site → no ReadyItems → skipped
    expect(result.code).toBe(0);
    expect(result.output).toContain("skipped");
  });

  it("returns the Resend message id in the output string", async () => {
    vi.mocked(openBase).mockReturnValue(
      makeFakeBase({ Reports: [readyReport()], Websites: [siteRow()] }),
    );
    const { client } = captureClient();
    const result = await runDigest({
      resend: client,
      baseUrl: "https://reddoor-maintenance.netlify.app",
    });
    expect(result.output).toContain("msg_1");
  });

  it("falls back to the constant when OPERATOR_EMAIL is unset", async () => {
    delete process.env.OPERATOR_EMAIL;
    vi.mocked(openBase).mockReturnValue(
      makeFakeBase({ Reports: [readyReport()], Websites: [siteRow()] }),
    );
    const { client, captured } = captureClient();
    await runDigest({ resend: client, baseUrl: "https://reddoor-maintenance.netlify.app" });
    expect(captured[0]!.to).toEqual(["info@reddoorla.com"]);
  });
});

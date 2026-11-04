import { describe, it, expect, vi } from "vitest";
import { makeWebsiteRow } from "../../_helpers/website-row.js";
import { captureClient } from "../../_helpers/resend-client.js";
import type { ReportRow } from "../../../src/reports/report-fields.js";
import type { TestSendInput } from "../../../src/db/test-sends.js";
import {
  testSendPayload,
  testSendReport,
  type TestSendDeps,
} from "../../../src/reports/send/test-send.js";

const OPERATOR = "op@example.test";
// Every client address the site row holds. None may reach a payload.
const SITE = makeWebsiteRow({
  id: "site_1",
  name: "Acme Co",
  reportRecipientsTo: "owner@client.test, ops@client.test",
  reportRecipientsCc: "cc@client.test",
  pointOfContact: "poc@client.test",
});
const report = (over: Partial<ReportRow>): ReportRow =>
  ({
    id: "report_1",
    reportId: "ACME-M",
    siteId: "site_1",
    sentAt: null,
    withdrawnAt: null,
    ...over,
  }) as ReportRow;
const RENDERED = {
  html: '<p>Acme October body <img src="cid:acme-co-header"></p>',
  attachments: [
    { filename: "acme-co-header.png", content: "aGVhZGVy", inlineContentId: "acme-co-header" },
  ],
  subject: "Your October report",
};

function deps(over: Partial<TestSendDeps> = {}) {
  const { client, captured } = captureClient("re_1");
  const logged: TestSendInput[] = [];
  const render = vi.fn<TestSendDeps["render"]>(async () => RENDERED);
  const d: TestSendDeps = {
    getReport: async (id) => (id === "report_1" ? report({}) : null),
    getSite: async (id) => (id === "site_1" ? SITE : null),
    getSiteBySlug: async (s) => (s === "acme-co" ? SITE : null),
    // Newest first, as listReportsForSite orders it (period_start desc).
    listReportsForSite: async () => [
      report({ id: "report_withdrawn", withdrawnAt: "2026-11-02T00:00:00Z" }),
      report({ id: "report_pending" }),
      report({ id: "report_sent", sentAt: "2026-10-01T00:00:00Z" }),
      report({ id: "report_older_pending" }),
    ],
    loadHeaderPlate: async () => new Uint8Array([1]),
    render,
    client,
    log: async (row) => {
      logged.push(row);
    },
    operator: () => OPERATOR,
    newId: () => "ts_1",
    now: () => new Date("2026-11-03T22:00:00Z"),
    ...over,
  };
  return { d, captured, logged, render };
}

describe("testSendPayload", () => {
  it("addresses the operator alone, prefixes [TEST], and carries no CC, BCC or reply-to", () => {
    const p = testSendPayload(RENDERED, OPERATOR, "ts_1");
    expect(p.to).toEqual([OPERATOR]);
    expect(p).not.toHaveProperty("cc");
    expect(p).not.toHaveProperty("bcc");
    expect(p).not.toHaveProperty("replyTo");
    expect(p.subject).toBe("[TEST] Your October report");
    expect(p.idempotencyKey).toBe("report-test-send:ts_1");
  });
});

describe("testSendReport (mocked transport)", () => {
  it("sends the row's render to operatorEmail() only, never the site's recipients", async () => {
    const { d, captured, render } = deps();
    const r = await testSendReport(d, "report_1");
    expect(captured).toHaveLength(1);
    expect(captured[0]!.to).toEqual([OPERATOR]);
    expect(captured[0]!.cc).toBeUndefined();
    expect(JSON.stringify(captured[0])).not.toContain("client.test");
    expect(render).toHaveBeenCalledWith(
      SITE,
      expect.objectContaining({ id: "report_1" }),
      new Uint8Array([1]),
    );
    // The email IS the render: its body and its inline header image, unchanged.
    expect(captured[0]!.html).toBe(RENDERED.html);
    expect(captured[0]!.attachments).toEqual(RENDERED.attachments);
    // Per send, so a second test send of the same report is a second email.
    expect(captured[0]!.idempotencyKey).toBe("report-test-send:ts_1");
    expect(r).toMatchObject({
      sendId: "ts_1",
      to: OPERATOR,
      messageId: "re_1",
      subject: "[TEST] Your October report",
    });
  });

  it("logs one row for the send, after it went out", async () => {
    const { d, logged } = deps();
    await testSendReport(d, "report_1");
    expect(logged).toEqual([
      {
        id: "ts_1",
        reportId: "report_1",
        siteId: "site_1",
        subject: "[TEST] Your October report",
        sentTo: OPERATOR,
        resendMessageId: "re_1",
        sentAt: new Date("2026-11-03T22:00:00Z"),
      },
    ]);
  });

  it("resolves a slug to the site's newest unsent, unwithdrawn report", async () => {
    const { d, render } = deps();
    await testSendReport(d, "acme-co");
    expect(render.mock.calls[0]![1].id).toBe("report_pending");
  });

  it("refuses an unknown ref, a site with no unsent report, and a missing header, sending nothing", async () => {
    const a = deps();
    await expect(testSendReport(a.d, "nope")).rejects.toThrow(/No report id or site slug/);
    const b = deps({
      listReportsForSite: async () => [report({ id: "report_sent", sentAt: "x" })],
    });
    await expect(testSendReport(b.d, "acme-co")).rejects.toThrow(/no unsent report.*report_sent/);
    const c = deps({ loadHeaderPlate: async () => null });
    await expect(testSendReport(c.d, "report_1")).rejects.toThrow(/no header plate/);
    expect([...a.captured, ...b.captured, ...c.captured]).toHaveLength(0);
  });

  it("refuses an operator address that is not an address", async () => {
    const { d, captured } = deps({ operator: () => "not an address" });
    await expect(testSendReport(d, "report_1")).rejects.toThrow(/not an address/);
    expect(captured).toHaveLength(0);
  });

  it("names the message and send id when the email went out but the row did not", async () => {
    const { d } = deps({
      log: async () => {
        throw new Error("db down");
      },
    });
    await expect(testSendReport(d, "report_1")).rejects.toThrow(
      /SENT \(message re_1, send ts_1.*db down/,
    );
  });
});

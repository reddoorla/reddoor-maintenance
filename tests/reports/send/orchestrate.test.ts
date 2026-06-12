import { describe, it, expect, beforeEach, vi } from "vitest";
import { sendApprovedReports } from "../../../src/reports/send/orchestrate.js";
import type { ResendClient, ResendSendInput } from "../../../src/reports/send/resend.js";
import { makeFakeBase, type FakeRecord } from "../_helpers/fake-airtable-base.js";

beforeEach(() => {
  // Stub global fetch — Airtable attachment fetch + bundled image loader read
  // (the latter via fs, but if anyone adds a fetch path it's covered).
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => "",
    headers: { get: () => "image/jpeg" },
    arrayBuffer: async () => new ArrayBuffer(8),
  }) as unknown as typeof global.fetch;
  process.env.AIRTABLE_PAT = "pat_test";
  process.env.AIRTABLE_BASE_ID = "app_test";
});

function siteRow(over: Partial<FakeRecord["fields"]> = {}): FakeRecord {
  return {
    id: "rec_site_acme",
    fields: {
      Name: "Acme Co",
      url: "https://acme.example.com",
      "point of contact": "ops@acme.example.com",
      "maintenence freq": "Monthly",
      "testing freq": "None",
      "Report recipients (To)": "explicit@acme.example.com",
      "Header image": [
        { url: "https://example.com/header.jpg", filename: "acme.jpg", type: "image/jpeg" },
      ],
      pScore: 87,
      rScore: 91,
      bpScore: 100,
      seoScore: 95,
      ...over,
    },
  };
}

function reportRow(over: Partial<FakeRecord["fields"]> = {}): FakeRecord {
  return {
    id: "rec_report_1",
    fields: {
      "Report ID": "Acme Co — Maintenance — 2026-05-26",
      Site: ["rec_site_acme"],
      "Report type": "Maintenance",
      "Period start": "2026-04-26",
      "Period end": "2026-05-26",
      "Completed on": "2026-05-26",
      "Lighthouse — Performance": 87,
      "Lighthouse — Accessibility": 91,
      "Lighthouse — Best Practices": 100,
      "Lighthouse — SEO": 95,
      "Draft ready": true,
      "Approved to send": true,
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

// Header image processing is exercised in header-image.test.ts. Here we stub it so the
// orchestrator runs against deterministic prepared output without real sharp work (the
// fetch stub returns placeholder bytes, not a decodable image).
vi.mock("../../../src/reports/maintenance-email/header-image.js", () => ({
  prepareHeaderImage: vi.fn(async () => ({
    bytes: new Uint8Array([255, 216, 255]),
    contentType: "image/jpeg",
    displayWidth: 600,
    displayHeight: 800,
    placeholderColor: "#cccccc",
  })),
}));

// Helper: openBase reads from env; tests need to inject a fake. Patch via vi.mock.
vi.mock("../../../src/reports/airtable/client.js", async () => {
  const actual = await vi.importActual<typeof import("../../../src/reports/airtable/client.js")>(
    "../../../src/reports/airtable/client.js",
  );
  return {
    ...actual,
    openBase: vi.fn(),
  };
});

import { openBase } from "../../../src/reports/airtable/client.js";

describe("sendApprovedReports", () => {
  it("returns 0 and 'No reports ready' when nothing is sendable", async () => {
    vi.mocked(openBase).mockReturnValue(makeFakeBase({ Reports: [], Websites: [siteRow()] }));
    const { client } = captureClient();
    const res = await sendApprovedReports({ resend: client });
    expect(res).toEqual({ output: "No reports ready to send.", code: 0 });
  });

  it("sends one report and stamps Sent at + Resend message ID (NOT Delivery status — H4)", async () => {
    const base = makeFakeBase({ Reports: [reportRow()], Websites: [siteRow()] });
    vi.mocked(openBase).mockReturnValue(base);
    const { client, captured } = captureClient();
    const res = await sendApprovedReports({ resend: client });
    expect(res.code).toBe(0);
    expect(res.output).toContain("✓ sent:");
    expect(captured).toHaveLength(1);

    // The stamp update must NOT touch Delivery status (H4: createDraft owns
    // that field; webhook overwrites later).
    const updates = base.__calls.filter((c) => c.kind === "update");
    const stamp = updates.find((u) => u.records[0]!.fields["Sent at"] !== undefined);
    expect(stamp).toBeDefined();
    expect(stamp!.records[0]!.fields["Resend message ID"]).toBe("msg_1");
    expect(stamp!.records[0]!.fields["Delivery status"]).toBeUndefined();
  });

  it("uses explicit Report recipients (To) over point-of-contact fallback", async () => {
    vi.mocked(openBase).mockReturnValue(
      makeFakeBase({ Reports: [reportRow()], Websites: [siteRow()] }),
    );
    const { client, captured } = captureClient();
    await sendApprovedReports({ resend: client });
    expect(captured[0]!.to).toEqual(["explicit@acme.example.com"]);
  });

  it("falls back to point-of-contact when Report recipients (To) is empty", async () => {
    vi.mocked(openBase).mockReturnValue(
      makeFakeBase({
        Reports: [reportRow()],
        Websites: [siteRow({ "Report recipients (To)": "" })],
      }),
    );
    const { client, captured } = captureClient();
    await sendApprovedReports({ resend: client });
    expect(captured[0]!.to).toEqual(["ops@acme.example.com"]);
  });

  it("fails the report when no recipients exist", async () => {
    vi.mocked(openBase).mockReturnValue(
      makeFakeBase({
        Reports: [reportRow()],
        Websites: [siteRow({ "Report recipients (To)": "", "point of contact": null })],
      }),
    );
    const { client } = captureClient();
    const res = await sendApprovedReports({ resend: client });
    expect(res.code).toBe(1);
    expect(res.output).toContain("no recipients");
  });

  it("fails the report when Header image is missing", async () => {
    vi.mocked(openBase).mockReturnValue(
      makeFakeBase({
        Reports: [reportRow()],
        Websites: [siteRow({ "Header image": [] })],
      }),
    );
    const { client } = captureClient();
    const res = await sendApprovedReports({ resend: client });
    expect(res.code).toBe(1);
    expect(res.output).toContain("no Header image");
  });

  it("explains that a malformed recipient must be a bare address (no `Name <addr>`)", async () => {
    vi.mocked(openBase).mockReturnValue(
      makeFakeBase({
        Reports: [reportRow()],
        Websites: [siteRow({ "Report recipients (To)": "Acme Ops <ops@acme.example.com>" })],
      }),
    );
    const { client } = captureClient();
    const res = await sendApprovedReports({ resend: client });
    expect(res.code).toBe(1);
    expect(res.output).toContain("malformed");
    expect(res.output).toMatch(/bare address only/i);
  });

  it("names the four Lighthouse cells when one is non-numeric", async () => {
    vi.mocked(openBase).mockReturnValue(
      makeFakeBase({
        // A non-numeric cell nulls the whole LighthouseScores object — the send-time
        // error should point the operator at the four cells, not just say "no scores".
        Reports: [reportRow({ "Lighthouse — Performance": "n/a" })],
        Websites: [siteRow()],
      }),
    );
    const { client } = captureClient();
    const res = await sendApprovedReports({ resend: client });
    expect(res.code).toBe(1);
    expect(res.output).toMatch(/Lighthouse/);
    expect(res.output).toMatch(/numeric/i);
  });

  it("uses Subject override when present", async () => {
    vi.mocked(openBase).mockReturnValue(
      makeFakeBase({
        Reports: [reportRow({ "Subject override": "Custom Subject" })],
        Websites: [siteRow()],
      }),
    );
    const { client, captured } = captureClient();
    await sendApprovedReports({ resend: client });
    expect(captured[0]!.subject).toBe("Custom Subject");
  });

  it("defaults Subject to `{Site name} — {Month YYYY} {Report type} Report`", async () => {
    vi.mocked(openBase).mockReturnValue(
      makeFakeBase({ Reports: [reportRow()], Websites: [siteRow()] }),
    );
    const { client, captured } = captureClient();
    await sendApprovedReports({ resend: client });
    // reportRow fixture: Completed on = 2026-05-26 → "May 2026".
    expect(captured[0]!.subject).toBe("Acme Co — May 2026 Maintenance Report");
  });

  it("attaches the per-site header with the expected CID + bundled images (B1 contract)", async () => {
    vi.mocked(openBase).mockReturnValue(
      makeFakeBase({ Reports: [reportRow()], Websites: [siteRow()] }),
    );
    const { client, captured } = captureClient();
    await sendApprovedReports({ resend: client });
    const atts = captured[0]!.attachments ?? [];
    const header = atts.find((a) => a.inlineContentId === "acme-co-header");
    const check = atts.find((a) => a.inlineContentId === "rd-check-png");
    const blurred = atts.find((a) => a.inlineContentId === "rd-blurred-tests-jpg");
    expect(header).toBeDefined();
    // Re-encoded to JPEG under a CID-derived name (orig may have been .png/.webp).
    expect(header!.filename).toBe("acme-co-header.jpg");
    expect(header!.contentType).toBe("image/jpeg");
    expect(check).toBeDefined();
    expect(blurred).toBeDefined();
  });

  it("passes idempotencyKey=report:<id> to Resend (B2 contract)", async () => {
    vi.mocked(openBase).mockReturnValue(
      makeFakeBase({ Reports: [reportRow()], Websites: [siteRow()] }),
    );
    const { client, captured } = captureClient();
    await sendApprovedReports({ resend: client });
    expect(captured[0]!.idempotencyKey).toBe("report:rec_report_1");
  });

  it("re-renders the stored page-1 rank into the sent email", async () => {
    vi.mocked(openBase).mockReturnValue(
      makeFakeBase({
        Reports: [reportRow({ "Search found page 1": true, "Search position": 4 })],
        Websites: [siteRow()],
      }),
    );
    const { client, captured } = captureClient();
    await sendApprovedReports({ resend: client });
    expect(captured[0]!.html).toContain("Page 1 Google Result (#4)");
  });

  it("logs site-not-found failure when a report's siteId has no matching Website", async () => {
    vi.mocked(openBase).mockReturnValue(
      makeFakeBase({
        Reports: [reportRow({ Site: ["rec_orphan"] })],
        Websites: [siteRow()],
      }),
    );
    const { client } = captureClient();
    const res = await sendApprovedReports({ resend: client });
    expect(res.code).toBe(1);
    expect(res.output).toContain("Site row not found for id=rec_orphan");
  });

  it("flips Status → maintenance + stamps Launched at after a Launch report sends (M6b)", async () => {
    const base = makeFakeBase({
      Reports: [reportRow({ "Report type": "Launch" })],
      Websites: [siteRow({ Status: "launch" })],
    });
    vi.mocked(openBase).mockReturnValue(base);
    const { client } = captureClient();
    const res = await sendApprovedReports({ resend: client });
    expect(res.code).toBe(0);
    expect(res.output).toContain("✓ sent:");
    expect(res.output).toContain("flipped to maintenance");

    // The flip writes Status + Launched at to the Websites row (NOT the Reports row).
    const flip = base.__calls.find(
      (c) =>
        c.kind === "update" &&
        c.table === "Websites" &&
        c.records[0]!.fields["Status"] !== undefined,
    );
    expect(flip).toBeDefined();
    expect(flip!.kind === "update" && flip!.records[0]!.id).toBe("rec_site_acme");
    expect(flip!.kind === "update" && flip!.records[0]!.fields["Status"]).toBe("maintenance");
    expect(flip!.kind === "update" && flip!.records[0]!.fields["Launched at"]).toBeDefined();
  });

  it("does NOT flip Status for a non-Launch (Maintenance) report", async () => {
    const base = makeFakeBase({ Reports: [reportRow()], Websites: [siteRow()] });
    vi.mocked(openBase).mockReturnValue(base);
    const { client } = captureClient();
    await sendApprovedReports({ resend: client });
    const flip = base.__calls.find(
      (c) =>
        c.kind === "update" &&
        c.table === "Websites" &&
        c.records[0]!.fields["Status"] !== undefined,
    );
    expect(flip).toBeUndefined();
  });

  it("does not fail the already-sent email when the launch flip errors (M6b)", async () => {
    const base = makeFakeBase({
      Reports: [reportRow({ "Report type": "Launch" })],
      Websites: [siteRow({ Status: "launch" })],
    });
    // Wrap the table factory so only the Websites update (the Status flip) throws.
    // The send + Reports stamp must still succeed; the flip failure becomes a warning,
    // not a hard failure, because the email already went out.
    const inner = base as unknown as (t: string) => Record<string, unknown>;
    const patched = ((t: string) => {
      const tbl = inner(t);
      if (t === "Websites") {
        return {
          ...tbl,
          update: async () => {
            throw new Error("Status field write blew up");
          },
        };
      }
      return tbl;
    }) as unknown as typeof base;
    patched.__calls = base.__calls;
    patched.__records = base.__records;
    vi.mocked(openBase).mockReturnValue(patched);
    const { client } = captureClient();
    const res = await sendApprovedReports({ resend: client });
    expect(res.code).toBe(0);
    expect(res.output).toContain("✓ sent:");
    expect(res.output).toContain("launch flip failed");
    expect(res.output).toContain("Status field write blew up");
  });
});

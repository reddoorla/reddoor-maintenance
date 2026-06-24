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
      // The 6 Maintenance checklist cells, all checked → the send gate is satisfied.
      // (Default fixture is a Maintenance report.) Gate-specific tests override.
      "Maint: Deploy & Function Health": true,
      "Maint: CMS Checked": true,
      "Maint: Domain, DNS & SSL": true,
      "Maint: Google Indexed": true,
      "Maint: Security Updates": true,
      "Maint: Uptime Checked": true,
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

/**
 * A ResendClient whose send() rejects with the real same-key/different-body 409
 * error string (`invalid_idempotent_request`) the way defaultResendClient wraps it
 * — `new Error("Resend error: This idempotency key has been used ...")`. Mirrors
 * the digest-run test's `idempotencyConflictClient`. `captured` records the
 * attempt(s) so a test can assert no SECOND send happens.
 */
function idempotencyConflictClient(): { client: ResendClient; captured: ResendSendInput[] } {
  const captured: ResendSendInput[] = [];
  const client: ResendClient = {
    async send(input) {
      captured.push(input);
      throw new Error(
        "Resend error: This idempotency key has been used with this HTTP method and endpoint " +
          "but the request body has changed.",
      );
    },
  };
  return { client, captured };
}

/** A ResendClient whose send() rejects with a generic (non-409) failure. */
function genericErrorClient(): { client: ResendClient; captured: ResendSendInput[] } {
  const captured: ResendSendInput[] = [];
  const client: ResendClient = {
    async send(input) {
      captured.push(input);
      throw new Error("Resend error: Internal server error");
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

  it("CCs info@reddoorla.com on every send, after any per-site CC", async () => {
    vi.mocked(openBase).mockReturnValue(
      makeFakeBase({
        Reports: [reportRow()],
        Websites: [siteRow({ "Report recipients (CC)": "cc@acme.example.com" })],
      }),
    );
    const { client, captured } = captureClient();
    await sendApprovedReports({ resend: client });
    expect(captured[0]!.cc).toEqual(["cc@acme.example.com", "info@reddoorla.com"]);
  });

  it("CCs info@reddoorla.com even when the site has no per-site CC", async () => {
    vi.mocked(openBase).mockReturnValue(
      makeFakeBase({
        Reports: [reportRow()],
        Websites: [siteRow({ "Report recipients (CC)": "" })],
      }),
    );
    const { client, captured } = captureClient();
    await sendApprovedReports({ resend: client });
    expect(captured[0]!.cc).toEqual(["info@reddoorla.com"]);
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

  it("validates recipients BEFORE the expensive header fetch/render (fails fast, no fetch)", async () => {
    // A misconfigured-recipients site is a guaranteed failure; recipient resolution
    // now runs before fetchAttachmentBytes + sharp + MJML render, so the header is
    // never fetched. Assert global.fetch (the header fetch) is not called.
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
    // The expensive path (header fetch) never ran for the bad-recipients site.
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects a malformed recipient BEFORE fetching the header (no expensive work)", async () => {
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
    expect(global.fetch).not.toHaveBeenCalled();
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

  // ── checklist gate: a Maintenance/Testing report can't escape with items unchecked ──
  it("does NOT send a Maintenance report whose checklist is incomplete (no Resend call, Sent at not stamped)", async () => {
    // Clear all 6 maintenance cells → the row is approved-to-send (e.g. ticked directly
    // in Airtable) but its checklist is incomplete. The send gate must skip it as a
    // failure, leaving Sent at blank so at-least-once retry is preserved.
    const base = makeFakeBase({
      Reports: [
        reportRow({
          "Maint: Deploy & Function Health": false,
          "Maint: CMS Checked": false,
          "Maint: Domain, DNS & SSL": false,
          "Maint: Google Indexed": false,
          "Maint: Security Updates": false,
          "Maint: Uptime Checked": false,
        }),
      ],
      Websites: [siteRow()],
    });
    vi.mocked(openBase).mockReturnValue(base);
    const { client, captured } = captureClient();
    const res = await sendApprovedReports({ resend: client });

    expect(res.code).toBe(1);
    expect(res.output).toContain("✗");
    expect(res.output).toMatch(/checklist incomplete/i);
    // No email went out.
    expect(captured).toHaveLength(0);
    // Sent at stays blank → the row replays next run once the operator finishes the checklist.
    const stamp = base.__calls
      .filter((c) => c.kind === "update")
      .find((u) => u.records[0]!.fields["Sent at"] !== undefined);
    expect(stamp).toBeUndefined();
  });

  it("sends a Maintenance report once its checklist is complete (default fixture is complete)", async () => {
    const base = makeFakeBase({ Reports: [reportRow()], Websites: [siteRow()] });
    vi.mocked(openBase).mockReturnValue(base);
    const { client, captured } = captureClient();
    const res = await sendApprovedReports({ resend: client });
    expect(res.code).toBe(0);
    expect(captured).toHaveLength(1);
  });

  it("re-renders an Announcement WITH cadence + improvements (both survive the send)", async () => {
    // Cadence + improvements are NOT stored on the Reports row — the send-time re-render must
    // re-derive them from the Websites row (via announcementSiteExtras), else the sent email
    // drops the cadence copy (and the checklist sections it heads) + the improvement callouts.
    // This is also the only place a fully-populated announcement is strict-rendered end to end.
    const base = makeFakeBase({
      Reports: [
        reportRow({
          "Report ID": "Acme Co — Announcement — 2026-06",
          "Report type": "Announcement",
        }),
      ],
      Websites: [siteRow({ "testing freq": "Monthly" })],
    });
    vi.mocked(openBase).mockReturnValue(base);
    const { client, captured } = captureClient();
    const res = await sendApprovedReports({ resend: client });
    expect(res.code).toBe(0);
    expect(captured).toHaveLength(1);
    const html = captured[0]!.html;
    expect(html).toContain("We run a full test every month"); // testing cadence baked into the copy
    expect(html).toContain("cid:rd-check-png"); // the checklist rows render with the check image
    expect(html).toContain("RECENT IMPROVEMENTS"); // improvements survive the send re-render
  });

  it("sends a Launch report regardless of checklist (Launch has no checklist gate)", async () => {
    // A Launch report has all 13 checkbox cells absent (false) — but checklistFor(Launch)
    // is [] so isChecklistComplete is vacuously true and the gate never fires.
    const base = makeFakeBase({
      Reports: [
        {
          ...reportRow({ "Report type": "Launch" }),
          fields: { ...reportRow({ "Report type": "Launch" }).fields },
        },
      ],
      Websites: [siteRow({ Status: "launch" })],
    });
    // Strip the 6 maintenance cells so the report has a genuinely empty checklist.
    const fields = base.__records.get("Reports")![0]!.fields;
    for (const k of Object.keys(fields)) if (k.startsWith("Maint: ")) delete fields[k];
    vi.mocked(openBase).mockReturnValue(base);
    const { client, captured } = captureClient();
    const res = await sendApprovedReports({ resend: client });
    expect(res.code).toBe(0);
    expect(captured).toHaveLength(1);
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

  it("does NOT attach the blurred-tests image to a Testing report (Maintenance-only), keeps check + header", async () => {
    // The blurred-tests image (cid:rd-blurred-tests-jpg) is referenced only by the Maintenance
    // template. A Testing report must not carry it as a dangling inline attachment. The check
    // image IS referenced by the testing checklist, so it stays.
    vi.mocked(openBase).mockReturnValue(
      makeFakeBase({
        Reports: [
          reportRow({
            "Report ID": "Acme Co — Testing — 2026-05-26",
            "Report type": "Testing",
            // checklistFor(Testing) = Maintenance + Testing cells; default fixture has the 6
            // Maint cells, so add the 7 Test cells to satisfy the send gate.
            "Test: Desktop Browsers": true,
            "Test: Mobile Browsers": true,
            "Test: Page Titles & Meta": true,
            "Test: Links & Navigation": true,
            "Test: Form Functionality": true,
            "Test: Interactions & Animations": true,
            "Test: Verified After Updates": true,
          }),
        ],
        Websites: [siteRow({ "testing freq": "Monthly" })],
      }),
    );
    const { client, captured } = captureClient();
    const res = await sendApprovedReports({ resend: client });
    expect(res.code).toBe(0);
    const atts = captured[0]!.attachments ?? [];
    expect(atts.find((a) => a.inlineContentId === "rd-blurred-tests-jpg")).toBeUndefined();
    expect(atts.find((a) => a.inlineContentId === "rd-check-png")).toBeDefined();
    expect(atts.find((a) => a.inlineContentId === "acme-co-header")).toBeDefined();
  });

  it("does NOT attach the blurred-tests image to an Announcement report (keeps check + header)", async () => {
    vi.mocked(openBase).mockReturnValue(
      makeFakeBase({
        Reports: [
          reportRow({
            "Report ID": "Acme Co — Announcement — 2026-06",
            "Report type": "Announcement",
          }),
        ],
        Websites: [siteRow({ "testing freq": "Monthly" })],
      }),
    );
    const { client, captured } = captureClient();
    const res = await sendApprovedReports({ resend: client });
    expect(res.code).toBe(0);
    const atts = captured[0]!.attachments ?? [];
    expect(atts.find((a) => a.inlineContentId === "rd-blurred-tests-jpg")).toBeUndefined();
    expect(atts.find((a) => a.inlineContentId === "rd-check-png")).toBeDefined();
  });

  it("attaches ONLY the header to a Launch report (no check, no blurred)", async () => {
    const base = makeFakeBase({
      Reports: [reportRow({ "Report type": "Launch" })],
      Websites: [siteRow({ Status: "launch" })],
    });
    // Launch has an empty checklist gate; strip the Maint cells so it's genuinely empty.
    const fields = base.__records.get("Reports")![0]!.fields;
    for (const k of Object.keys(fields)) if (k.startsWith("Maint: ")) delete fields[k];
    vi.mocked(openBase).mockReturnValue(base);
    const { client, captured } = captureClient();
    const res = await sendApprovedReports({ resend: client });
    expect(res.code).toBe(0);
    const atts = captured[0]!.attachments ?? [];
    expect(atts.map((a) => a.inlineContentId)).toEqual(["acme-co-header"]);
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

  // ── send-durability: Resend 409 idempotency-conflict in sendOne ──────────────
  it("catches a Resend 409 idempotency-conflict, stamps Sent at (stops the replay), and returns success — no second send", async () => {
    // A prior run sent the email under report:<id> but failed to stampSent, so the
    // row replayed with a changed body and Resend rejected the same-key/different-body
    // re-send with a 409. sendOne must NOT re-throw and must NOT re-send: instead it
    // stamps the row (so it stops replaying) and reports success.
    const base = makeFakeBase({ Reports: [reportRow()], Websites: [siteRow()] });
    vi.mocked(openBase).mockReturnValue(base);
    const { client, captured } = idempotencyConflictClient();
    const res = await sendApprovedReports({ resend: client });

    expect(res.code).toBe(0);
    // Treated as a success by the caller (so the Launch flip runs); the
    // conflict-resolved messageId marks it as the already-sent path.
    expect(res.output).toContain("✓ sent:");
    expect(res.output).toContain("idempotent-conflict");
    // Exactly ONE send attempt — the 409 path must not fire a second client.send.
    expect(captured).toHaveLength(1);

    // The row got stamped (Sent at written) so listSendableReports won't replay it.
    const updates = base.__calls.filter((c) => c.kind === "update");
    const stamp = updates.find((u) => u.records[0]!.fields["Sent at"] !== undefined);
    expect(stamp).toBeDefined();
    expect(stamp!.records[0]!.id).toBe("rec_report_1");
    // The message id is unrecoverable on the 409 path, so the column must be left
    // unset — NOT stamped with a sentinel that would masquerade as a real Resend
    // id and orphan findReportByMessageId webhook lookups.
    expect(stamp!.records[0]!.fields["Resend message ID"]).toBeUndefined();
  });

  it("re-throws a generic (non-409) send error so the run reds and the row is NOT stamped", async () => {
    const base = makeFakeBase({ Reports: [reportRow()], Websites: [siteRow()] });
    vi.mocked(openBase).mockReturnValue(base);
    const { client } = genericErrorClient();
    const res = await sendApprovedReports({ resend: client });

    expect(res.code).toBe(1);
    expect(res.output).toContain("✗");
    expect(res.output).toContain("Internal server error");

    // A genuine failure must leave Sent at blank so the row replays next run.
    const updates = base.__calls.filter((c) => c.kind === "update");
    const stamp = updates.find((u) => u.records[0]!.fields["Sent at"] !== undefined);
    expect(stamp).toBeUndefined();
  });

  it("self-heals a stranded Launch on the 409 path: the conflict-resolved send still flips Status → maintenance", async () => {
    const base = makeFakeBase({
      Reports: [reportRow({ "Report type": "Launch" })],
      Websites: [siteRow({ Status: "launch" })],
    });
    vi.mocked(openBase).mockReturnValue(base);
    const { client } = idempotencyConflictClient();
    const res = await sendApprovedReports({ resend: client });

    expect(res.code).toBe(0);
    expect(res.output).toContain("flipped to maintenance");

    // The Launch flip runs after the (conflict-resolved) success, so a launch that
    // sent-but-never-flipped on the prior run reconciles here.
    const flip = base.__calls.find(
      (c) =>
        c.kind === "update" &&
        c.table === "Websites" &&
        c.records[0]!.fields["Status"] !== undefined,
    );
    expect(flip).toBeDefined();
    expect(flip!.kind === "update" && flip!.records[0]!.fields["Status"]).toBe("maintenance");
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

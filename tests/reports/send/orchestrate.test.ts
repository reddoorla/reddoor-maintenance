import { describe, it, expect, vi } from "vitest";
import { sendApprovedReports } from "../../../src/reports/send/orchestrate.js";
import type { ResendClient, ResendSendInput } from "../../../src/reports/send/resend.js";
import { reportRowsFrom, websiteRowsFrom, type RawRow } from "../../_helpers/raw-rows.js";

function siteRow(over: Record<string, unknown> = {}): RawRow {
  return {
    id: "rec_site_acme",
    fields: {
      Name: "Acme Co",
      url: "https://acme.example.com",
      "point of contact": "ops@acme.example.com",
      "maintenence freq": "Monthly",
      "testing freq": "None",
      "Report recipients (To)": "explicit@acme.example.com",
      pScore: 87,
      rScore: 91,
      bpScore: 100,
      seoScore: 95,
      ...over,
    },
  };
}

function reportRow(over: Record<string, unknown> = {}): RawRow {
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
      // The gate now reads HEALTH evidence, not the manual booleans above — all 5 gating
      // fields pass so the many non-gate send tests (using this default fixture) keep passing.
      "Checklist auto-evidence": JSON.stringify({
        "Maint: Deploy & Function Health": {
          result: "pass",
          checkedAt: "2026-05-26T00:00:00.000Z",
          note: "",
        },
        "Maint: CMS Checked": { result: "pass", checkedAt: "2026-05-26T00:00:00.000Z", note: "" },
        "Maint: Domain, DNS & SSL": {
          result: "pass",
          checkedAt: "2026-05-26T00:00:00.000Z",
          note: "",
        },
        "Maint: Security Updates": {
          result: "pass",
          checkedAt: "2026-05-26T00:00:00.000Z",
          note: "",
        },
        "Maint: Uptime Checked": {
          result: "pass",
          checkedAt: "2026-05-26T00:00:00.000Z",
          note: "",
        },
      }),
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
// stored plate below is placeholder bytes, not a decodable image).
vi.mock("../../../src/reports/maintenance-email/header-image.js", () => ({
  prepareHeaderImage: vi.fn(async () => ({
    bytes: new Uint8Array([255, 216, 255]),
    contentType: "image/jpeg",
    displayWidth: 600,
    displayHeight: 800,
    placeholderColor: "#cccccc",
  })),
}));

vi.mock("../../../src/audits/fleet-events-writer.js", () => ({
  recordFleetEventsBestEffort: vi.fn().mockResolvedValue(undefined),
}));

import { recordFleetEventsBestEffort } from "../../../src/audits/fleet-events-writer.js";

type Seed = { Reports: RawRow[]; Websites: RawRow[] };

const PLATE = new Uint8Array([1, 2, 3]);

/**
 * #646 step 4: the send reads its queue, its roster and its header plate from
 * TURSO, and writes the sent stamp and the Launch flip there. `plates` lists
 * the site ids Turso holds a header plate for (default: every seeded site).
 * The Turso-backed queue is driven end to end in send-turso.test.ts.
 */
function harness(seed: Seed, plates: string[] = seed.Websites.map((w) => w.id)) {
  const stamps: Array<{ id: string; sentAt: Date; messageId: string | null }> = [];
  const siteWrites: Array<{ id: string; fields: Record<string, unknown> }> = [];
  const plateReads: string[] = [];
  return {
    seed,
    stamps,
    siteWrites,
    plateReads,
    io: {
      sendable: async () =>
        reportRowsFrom(seed.Reports).filter((r) => r.draftReady && r.approvedToSend && !r.sentAt),
      roster: async () => websiteRowsFrom(seed.Websites),
      loadHeaderPlate: async (siteId: string) => {
        plateReads.push(siteId);
        return plates.includes(siteId) ? PLATE : null;
      },
      reportSentMirror: async (id: string, sentAt: Date, messageId: string | null) => {
        stamps.push({ id, sentAt, messageId });
      },
      claimForSend: async () => true,
      releaseSendClaim: async () => {},
      siteMirror: {
        health: async () => {},
        site: async (id: string, fields: Record<string, unknown>) => {
          siteWrites.push({ id, fields });
        },
      },
    },
  };
}

describe("sendApprovedReports", () => {
  it("never sends a withdrawn row, even one that is somehow approved (P1-28)", async () => {
    const h = harness({
      Reports: [reportRow({ "Withdrawn at": "2026-05-27T00:00:00.000Z" })],
      Websites: [siteRow()],
    });
    const { client, captured } = captureClient();
    const res = await sendApprovedReports({ ...h.io, resend: client });
    expect(captured).toHaveLength(0);
    expect(h.stamps).toEqual([]);
    expect(res.output).toContain("skipped (withdrawn)");
    expect(res.code).toBe(0);
  });

  it("a lost claim skips the report: no email, no stamp, a green run (#1262)", async () => {
    const h = harness({ Reports: [reportRow()], Websites: [siteRow()] });
    const { client, captured } = captureClient();
    const claims: string[] = [];
    const res = await sendApprovedReports({
      ...h.io,
      resend: client,
      claimForSend: async (id) => {
        claims.push(id);
        return false;
      },
    });
    expect(claims).toHaveLength(1);
    expect(captured).toHaveLength(0);
    expect(h.stamps).toEqual([]);
    expect(res.output).toContain("skipped (unapproved or withdrawn since the queue was read)");
    expect(res.code).toBe(0);
  });

  it("the claim is taken before Resend is called, never after (#1262)", async () => {
    const h = harness({ Reports: [reportRow()], Websites: [siteRow()] });
    const order: string[] = [];
    const client: ResendClient = {
      async send() {
        order.push("send");
        return { messageId: "msg_1" };
      },
    };
    await sendApprovedReports({
      ...h.io,
      resend: client,
      claimForSend: async () => {
        order.push("claim");
        return true;
      },
    });
    expect(order).toEqual(["claim", "send"]);
  });

  it("returns 0 and 'No reports ready' when nothing is sendable", async () => {
    const h = harness({ Reports: [], Websites: [siteRow()] });
    const { client } = captureClient();
    const res = await sendApprovedReports({ ...h.io, resend: client });
    expect(res).toEqual({ output: "No reports ready to send.", code: 0 });
  });

  it("sends one report and stamps Sent at + Resend message ID through reportSentMirror", async () => {
    const h = harness({ Reports: [reportRow()], Websites: [siteRow()] });
    const { client, captured } = captureClient();
    const res = await sendApprovedReports({ ...h.io, resend: client });
    expect(res.code).toBe(0);
    expect(res.output).toContain("✓ sent:");
    expect(captured).toHaveLength(1);
    expect(h.stamps).toEqual([
      { id: "rec_report_1", sentAt: expect.any(Date), messageId: "msg_1" },
    ]);
  });

  it("uses explicit Report recipients (To) over point-of-contact fallback", async () => {
    const h = harness({ Reports: [reportRow()], Websites: [siteRow()] });
    const { client, captured } = captureClient();
    await sendApprovedReports({ ...h.io, resend: client });
    expect(captured[0]!.to).toEqual(["explicit@acme.example.com"]);
  });

  it("falls back to point-of-contact when Report recipients (To) is empty", async () => {
    const h = harness({
      Reports: [reportRow()],
      Websites: [siteRow({ "Report recipients (To)": "" })],
    });
    const { client, captured } = captureClient();
    await sendApprovedReports({ ...h.io, resend: client });
    expect(captured[0]!.to).toEqual(["ops@acme.example.com"]);
  });

  it("CCs info@reddoorla.com on every send, after any per-site CC", async () => {
    const h = harness({
      Reports: [reportRow()],
      Websites: [siteRow({ "Report recipients (CC)": "cc@acme.example.com" })],
    });
    const { client, captured } = captureClient();
    await sendApprovedReports({ ...h.io, resend: client });
    expect(captured[0]!.cc).toEqual(["cc@acme.example.com", "info@reddoorla.com"]);
  });

  it("CCs info@reddoorla.com even when the site has no per-site CC", async () => {
    const h = harness({
      Reports: [reportRow()],
      Websites: [siteRow({ "Report recipients (CC)": "" })],
    });
    const { client, captured } = captureClient();
    await sendApprovedReports({ ...h.io, resend: client });
    expect(captured[0]!.cc).toEqual(["info@reddoorla.com"]);
  });

  it("fails the report when no recipients exist", async () => {
    const h = harness({
      Reports: [reportRow()],
      Websites: [siteRow({ "Report recipients (To)": "", "point of contact": null })],
    });
    const { client } = captureClient();
    const res = await sendApprovedReports({ ...h.io, resend: client });
    expect(res.code).toBe(1);
    expect(res.output).toContain("no recipients");
  });

  it("validates recipients BEFORE the expensive header load/render (fails fast, no load)", async () => {
    // A misconfigured-recipients site is a guaranteed failure; recipient resolution
    // runs before the header plate load + sharp + MJML render, so the plate is
    // never read.
    const h = harness({
      Reports: [reportRow()],
      Websites: [siteRow({ "Report recipients (To)": "", "point of contact": null })],
    });
    const { client } = captureClient();
    const res = await sendApprovedReports({ ...h.io, resend: client });
    expect(res.code).toBe(1);
    expect(res.output).toContain("no recipients");
    // The expensive path (header load) never ran for the bad-recipients site.
    expect(h.plateReads).toEqual([]);
  });

  it("rejects a malformed recipient BEFORE loading the header (no expensive work)", async () => {
    const h = harness({
      Reports: [reportRow()],
      Websites: [siteRow({ "Report recipients (To)": "Acme Ops <ops@acme.example.com>" })],
    });
    const { client } = captureClient();
    const res = await sendApprovedReports({ ...h.io, resend: client });
    expect(res.code).toBe(1);
    expect(res.output).toContain("malformed");
    expect(h.plateReads).toEqual([]);
  });

  it("fails the report by name when Turso holds no header plate", async () => {
    const h = harness({ Reports: [reportRow()], Websites: [siteRow()] }, []);
    const { client, captured } = captureClient();
    const res = await sendApprovedReports({ ...h.io, resend: client });
    expect(res.code).toBe(1);
    expect(res.output).toContain(
      "✗ Acme Co — Maintenance — 2026-05-26 — Site 'Acme Co' has no Header image: " +
        "no header plate in Turso — run `reddoor-maint header-image acme-co --write-back`",
    );
    expect(h.plateReads).toEqual(["rec_site_acme"]);
    expect(captured).toHaveLength(0);
    expect(h.stamps).toEqual([]);
  });

  it("explains that a malformed recipient must be a bare address (no `Name <addr>`)", async () => {
    const h = harness({
      Reports: [reportRow()],
      Websites: [siteRow({ "Report recipients (To)": "Acme Ops <ops@acme.example.com>" })],
    });
    const { client } = captureClient();
    const res = await sendApprovedReports({ ...h.io, resend: client });
    expect(res.code).toBe(1);
    expect(res.output).toContain("malformed");
    expect(res.output).toMatch(/bare address only/i);
  });

  it("names the four Lighthouse cells when one is non-numeric", async () => {
    const h = harness({
      // A non-numeric cell nulls the whole LighthouseScores object — the send-time
      // error should point the operator at the four cells, not just say "no scores".
      Reports: [reportRow({ "Lighthouse — Performance": "n/a" })],
      Websites: [siteRow()],
    });
    const { client } = captureClient();
    const res = await sendApprovedReports({ ...h.io, resend: client });
    expect(res.code).toBe(1);
    expect(res.output).toMatch(/Lighthouse/);
    expect(res.output).toMatch(/numeric/i);
  });

  // ── health gate: a Maintenance/Testing report can't escape with unmeasured/failing evidence ──
  it("does NOT send a Maintenance report whose health gate is not clear (no Resend call, Sent at not stamped)", async () => {
    // No auto-evidence recorded at all → every gating field reads "unknown" → the health gate
    // blocks, even though the row is approved-to-send (with the operator checklist booleans
    // ticked too — those no longer drive the gate). The send
    // gate must skip it as a failure, leaving Sent at blank so at-least-once retry is preserved.
    const h = harness({
      Reports: [
        reportRow({
          "Checklist auto-evidence": JSON.stringify({}),
        }),
      ],
      Websites: [siteRow()],
    });
    const { client, captured } = captureClient();
    const res = await sendApprovedReports({ ...h.io, resend: client });

    expect(res.code).toBe(1);
    expect(res.output).toContain("✗");
    expect(res.output).toMatch(/health gate not clear/i);
    // No email went out.
    expect(captured).toHaveLength(0);
    // Sent at stays blank → the row replays next run once the evidence is fresh and green.
    expect(h.stamps).toEqual([]);
  });

  it("sends a Maintenance report once its checklist is complete (default fixture is complete)", async () => {
    const h = harness({ Reports: [reportRow()], Websites: [siteRow()] });
    const { client, captured } = captureClient();
    const res = await sendApprovedReports({ ...h.io, resend: client });
    expect(res.code).toBe(0);
    expect(captured).toHaveLength(1);
  });

  it("re-renders an Announcement WITH cadence + improvements (both survive the send)", async () => {
    // Cadence + improvements are NOT stored on the Reports row — the send-time re-render must
    // re-derive them from the Websites row (via announcementSiteExtras), else the sent email
    // drops the cadence copy (and the checklist sections it heads) + the improvement callouts.
    // This is also the only place a fully-populated announcement is strict-rendered end to end.
    const h = harness({
      Reports: [
        reportRow({
          "Report ID": "Acme Co — Announcement — 2026-06",
          "Report type": "Announcement",
        }),
      ],
      Websites: [siteRow({ "testing freq": "Monthly" })],
    });
    const { client, captured } = captureClient();
    const res = await sendApprovedReports({ ...h.io, resend: client });
    expect(res.code).toBe(0);
    expect(captured).toHaveLength(1);
    const html = captured[0]!.html;
    expect(html).toContain("We run a full test every month"); // testing cadence baked into the copy
    expect(html).toContain("cid:rd-check-png"); // the checklist rows render with the check image
    expect(html).toContain("RECENT IMPROVEMENTS"); // improvements survive the send re-render
  });

  it("does NOT send a Maintenance report whose health gate is not clear, with a by-name message", async () => {
    const h = harness({
      Reports: [
        reportRow({
          "Checklist auto-evidence": JSON.stringify({
            "Maint: Deploy & Function Health": {
              result: "pass",
              checkedAt: "2026-05-26T00:00:00.000Z",
              note: "",
            },
            "Maint: CMS Checked": {
              result: "fail",
              checkedAt: "2026-05-26T00:00:00.000Z",
              note: "Prismic unreachable",
            },
            "Maint: Domain, DNS & SSL": {
              result: "pass",
              checkedAt: "2026-05-26T00:00:00.000Z",
              note: "",
            },
            "Maint: Security Updates": {
              result: "pass",
              checkedAt: "2026-05-26T00:00:00.000Z",
              note: "",
            },
            "Maint: Uptime Checked": {
              result: "pass",
              checkedAt: "2026-05-26T00:00:00.000Z",
              note: "",
            },
          }),
        }),
      ],
      Websites: [siteRow()],
    });
    const { client, captured } = captureClient();
    const res = await sendApprovedReports({ ...h.io, resend: client });
    expect(res.code).toBe(1);
    expect(captured).toHaveLength(0);
    expect(res.output).toContain("Maint: CMS Checked");
  });

  it("sends an overridden Maintenance report even though its health gate is red, and logs the override event", async () => {
    const overriddenReport = reportRow({
      "Checklist auto-evidence": JSON.stringify({
        "Maint: Deploy & Function Health": {
          result: "pass",
          checkedAt: "2026-05-26T00:00:00.000Z",
          note: "",
        },
        "Maint: CMS Checked": {
          result: "fail",
          checkedAt: "2026-05-26T00:00:00.000Z",
          note: "Prismic unreachable",
        },
        "Maint: Domain, DNS & SSL": {
          result: "pass",
          checkedAt: "2026-05-26T00:00:00.000Z",
          note: "",
        },
        "Maint: Security Updates": {
          result: "pass",
          checkedAt: "2026-05-26T00:00:00.000Z",
          note: "",
        },
        "Maint: Uptime Checked": {
          result: "pass",
          checkedAt: "2026-05-26T00:00:00.000Z",
          note: "",
        },
      }),
      "Send override": true,
      "Override reason": "client verbally signed off",
      "Override by": "dashboard",
    });
    const h = harness({ Reports: [overriddenReport], Websites: [siteRow()] });
    const { client, captured } = captureClient();
    const res = await sendApprovedReports({ ...h.io, resend: client });
    expect(res.code).toBe(0);
    expect(captured).toHaveLength(1);
    expect(vi.mocked(recordFleetEventsBestEffort)).toHaveBeenCalled();
    const [events] = vi.mocked(recordFleetEventsBestEffort).mock.calls.at(-1)!;
    expect(events[0]!.type).toBe("report_sent_with_override");
    expect(events[0]!.summary).toContain("client verbally signed off");
  });

  it("sends a Launch report regardless of checklist (Launch has no checklist gate)", async () => {
    // A Launch report has all 13 checkbox cells absent (false) — but gatingFields(Launch)
    // is [] so isHealthGateClear is vacuously true and the gate never fires.
    const h = harness({
      Reports: [
        {
          ...reportRow({ "Report type": "Launch" }),
          fields: { ...reportRow({ "Report type": "Launch" }).fields },
        },
      ],
      Websites: [siteRow({ Status: "launch" })],
    });
    // Strip the 6 maintenance cells so the report has a genuinely empty checklist.
    const fields = h.seed.Reports[0]!.fields;
    for (const k of Object.keys(fields)) if (k.startsWith("Maint: ")) delete fields[k];
    const { client, captured } = captureClient();
    const res = await sendApprovedReports({ ...h.io, resend: client });
    expect(res.code).toBe(0);
    expect(captured).toHaveLength(1);
  });

  it("uses Subject override when present", async () => {
    const h = harness({
      Reports: [reportRow({ "Subject override": "Custom Subject" })],
      Websites: [siteRow()],
    });
    const { client, captured } = captureClient();
    await sendApprovedReports({ ...h.io, resend: client });
    expect(captured[0]!.subject).toBe("Custom Subject");
  });

  it("defaults Subject to `{Site name} — {Month YYYY} {Report type} Report`", async () => {
    const h = harness({ Reports: [reportRow()], Websites: [siteRow()] });
    const { client, captured } = captureClient();
    await sendApprovedReports({ ...h.io, resend: client });
    // reportRow fixture: Completed on = 2026-05-26 → "May 2026".
    expect(captured[0]!.subject).toBe("Acme Co — May 2026 Maintenance Report");
  });

  it("attaches the per-site header with the expected CID + bundled images (B1 contract)", async () => {
    const h = harness({ Reports: [reportRow()], Websites: [siteRow()] });
    const { client, captured } = captureClient();
    await sendApprovedReports({ ...h.io, resend: client });
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
    const h = harness({
      Reports: [
        reportRow({
          "Report ID": "Acme Co — Testing — 2026-05-26",
          "Report type": "Testing",
          // checklistFor(Testing) = Maintenance + Testing cells; the operator-checklist
          // booleans below are advisory only now — gatingFields(Testing) is all 13 cells
          // (including Maint: Google Indexed), so the evidence override supplies pass for
          // all 13 to satisfy the health gate.
          "Test: Desktop Browsers": true,
          "Test: Mobile Browsers": true,
          "Test: Page Titles & Meta": true,
          "Test: Links & Navigation": true,
          "Test: Form Functionality": true,
          "Test: Interactions & Animations": true,
          "Test: Verified After Updates": true,
          "Checklist auto-evidence": JSON.stringify({
            "Maint: Deploy & Function Health": {
              result: "pass",
              checkedAt: "2026-05-26T00:00:00.000Z",
              note: "",
            },
            "Maint: CMS Checked": {
              result: "pass",
              checkedAt: "2026-05-26T00:00:00.000Z",
              note: "",
            },
            "Maint: Domain, DNS & SSL": {
              result: "pass",
              checkedAt: "2026-05-26T00:00:00.000Z",
              note: "",
            },
            "Maint: Google Indexed": {
              result: "pass",
              checkedAt: "2026-05-26T00:00:00.000Z",
              note: "",
            },
            "Maint: Security Updates": {
              result: "pass",
              checkedAt: "2026-05-26T00:00:00.000Z",
              note: "",
            },
            "Maint: Uptime Checked": {
              result: "pass",
              checkedAt: "2026-05-26T00:00:00.000Z",
              note: "",
            },
            "Test: Desktop Browsers": {
              result: "pass",
              checkedAt: "2026-05-26T00:00:00.000Z",
              note: "",
            },
            "Test: Mobile Browsers": {
              result: "pass",
              checkedAt: "2026-05-26T00:00:00.000Z",
              note: "",
            },
            "Test: Page Titles & Meta": {
              result: "pass",
              checkedAt: "2026-05-26T00:00:00.000Z",
              note: "",
            },
            "Test: Links & Navigation": {
              result: "pass",
              checkedAt: "2026-05-26T00:00:00.000Z",
              note: "",
            },
            "Test: Form Functionality": {
              result: "pass",
              checkedAt: "2026-05-26T00:00:00.000Z",
              note: "",
            },
            "Test: Interactions & Animations": {
              result: "pass",
              checkedAt: "2026-05-26T00:00:00.000Z",
              note: "",
            },
            "Test: Verified After Updates": {
              result: "pass",
              checkedAt: "2026-05-26T00:00:00.000Z",
              note: "",
            },
          }),
        }),
      ],
      Websites: [siteRow({ "testing freq": "Monthly" })],
    });
    const { client, captured } = captureClient();
    const res = await sendApprovedReports({ ...h.io, resend: client });
    expect(res.code).toBe(0);
    const atts = captured[0]!.attachments ?? [];
    expect(atts.find((a) => a.inlineContentId === "rd-blurred-tests-jpg")).toBeUndefined();
    expect(atts.find((a) => a.inlineContentId === "rd-check-png")).toBeDefined();
    expect(atts.find((a) => a.inlineContentId === "acme-co-header")).toBeDefined();
  });

  it("does NOT attach the blurred-tests image to an Announcement report (keeps check + header)", async () => {
    const h = harness({
      Reports: [
        reportRow({
          "Report ID": "Acme Co — Announcement — 2026-06",
          "Report type": "Announcement",
        }),
      ],
      Websites: [siteRow({ "testing freq": "Monthly" })],
    });
    const { client, captured } = captureClient();
    const res = await sendApprovedReports({ ...h.io, resend: client });
    expect(res.code).toBe(0);
    const atts = captured[0]!.attachments ?? [];
    expect(atts.find((a) => a.inlineContentId === "rd-blurred-tests-jpg")).toBeUndefined();
    expect(atts.find((a) => a.inlineContentId === "rd-check-png")).toBeDefined();
  });

  it("attaches ONLY the header to a Launch report (no check, no blurred)", async () => {
    const h = harness({
      Reports: [reportRow({ "Report type": "Launch" })],
      Websites: [siteRow({ Status: "launch" })],
    });
    // Launch has an empty checklist gate; strip the Maint cells so it's genuinely empty.
    const fields = h.seed.Reports[0]!.fields;
    for (const k of Object.keys(fields)) if (k.startsWith("Maint: ")) delete fields[k];
    const { client, captured } = captureClient();
    const res = await sendApprovedReports({ ...h.io, resend: client });
    expect(res.code).toBe(0);
    const atts = captured[0]!.attachments ?? [];
    expect(atts.map((a) => a.inlineContentId)).toEqual(["acme-co-header"]);
  });

  it("passes idempotencyKey=report:<id> to Resend (B2 contract)", async () => {
    const h = harness({ Reports: [reportRow()], Websites: [siteRow()] });
    const { client, captured } = captureClient();
    await sendApprovedReports({ ...h.io, resend: client });
    expect(captured[0]!.idempotencyKey).toBe("report:rec_report_1");
  });

  it("re-renders the stored page-1 rank into the sent email", async () => {
    const h = harness({
      Reports: [reportRow({ "Search found page 1": true, "Search position": 4 })],
      Websites: [siteRow()],
    });
    const { client, captured } = captureClient();
    await sendApprovedReports({ ...h.io, resend: client });
    expect(captured[0]!.html).toContain("Page 1 Google Result (#4)");
  });

  it("labels the analytics trend with the stored period window length on re-render", async () => {
    const h = harness({
      // Default fixture period is 2026-04-26 → 2026-05-26 = 30 days.
      Reports: [reportRow({ "GA users (period)": 679, "GA users (prev period)": 549 })],
      Websites: [siteRow()],
    });
    const { client, captured } = captureClient();
    await sendApprovedReports({ ...h.io, resend: client });
    expect(captured[0]!.html).toContain("vs the previous 30 days");
  });

  it("logs site-not-found failure when a report's siteId has no matching Website", async () => {
    const h = harness({
      Reports: [reportRow({ Site: ["rec_orphan"] })],
      Websites: [siteRow()],
    });
    const { client } = captureClient();
    const res = await sendApprovedReports({ ...h.io, resend: client });
    expect(res.code).toBe(1);
    expect(res.output).toContain("Site row not found for id=rec_orphan");
  });

  it("flips Status → maintained + stamps Launched at in ONE Turso write after a Launch report sends (M6b)", async () => {
    // Status and `Launched at` must travel together: mirroring them as two
    // updates would open a window where Turso says a site is maintained but
    // never launched — and the cockpit reads both.
    const h = harness({
      Reports: [reportRow({ "Report type": "Launch" })],
      Websites: [siteRow({ Status: "launch" })],
    });
    const { client } = captureClient();
    const res = await sendApprovedReports({ ...h.io, resend: client });
    expect(res.code).toBe(0);
    expect(res.output).toContain("✓ sent:");
    expect(res.output).toContain("flipped to maintained");

    // The flip writes Status + Launched at to the site row (NOT the report row).
    expect(h.siteWrites).toHaveLength(1);
    expect(h.siteWrites[0]!.id).toBe("rec_site_acme");
    expect(h.siteWrites[0]!.fields["Status"]).toBe("maintained");
    expect(h.siteWrites[0]!.fields["Launched at"]).toBeDefined();
    expect(h.siteWrites[0]!.fields).toEqual({
      Status: "maintained",
      "Launched at": expect.any(String),
    });
  });

  it("does NOT flip Status for a non-Launch (Maintenance) report", async () => {
    const h = harness({ Reports: [reportRow()], Websites: [siteRow()] });
    const { client } = captureClient();
    await sendApprovedReports({ ...h.io, resend: client });
    expect(h.siteWrites).toEqual([]);
  });

  // ── send-durability: Resend 409 idempotency-conflict in sendOne ──────────────
  it("catches a Resend 409 idempotency-conflict, stamps Sent at (stops the replay), and returns success — no second send", async () => {
    // A prior run sent the email under report:<id> but failed to stampSent, so the
    // row replayed with a changed body and Resend rejected the same-key/different-body
    // re-send with a 409. sendOne must NOT re-throw and must NOT re-send: instead it
    // stamps the row (so it stops replaying) and reports success.
    const h = harness({ Reports: [reportRow()], Websites: [siteRow()] });
    const { client, captured } = idempotencyConflictClient();
    const res = await sendApprovedReports({ ...h.io, resend: client });

    expect(res.code).toBe(0);
    // Treated as a success by the caller (so the Launch flip runs); the
    // conflict-resolved messageId marks it as the already-sent path.
    expect(res.output).toContain("✓ sent:");
    expect(res.output).toContain("idempotent-conflict");
    // Exactly ONE send attempt — the 409 path must not fire a second client.send.
    expect(captured).toHaveLength(1);

    // The row got stamped (Sent at written) so listSendableReports won't replay it.
    // The message id is unrecoverable on the 409 path, so it must be left null —
    // NOT stamped with a sentinel that would masquerade as a real Resend id and
    // orphan findReportByMessageId webhook lookups.
    expect(h.stamps).toEqual([{ id: "rec_report_1", sentAt: expect.any(Date), messageId: null }]);
  });

  it("re-throws a generic (non-409) send error so the run reds and the row is NOT stamped", async () => {
    const h = harness({ Reports: [reportRow()], Websites: [siteRow()] });
    const { client } = genericErrorClient();
    const res = await sendApprovedReports({ ...h.io, resend: client });

    expect(res.code).toBe(1);
    expect(res.output).toContain("✗");
    expect(res.output).toContain("Internal server error");

    // A genuine failure must leave Sent at blank so the row replays next run.
    expect(h.stamps).toEqual([]);
  });

  it("self-heals a stranded Launch on the 409 path: the conflict-resolved send still flips Status → maintained", async () => {
    const h = harness({
      Reports: [reportRow({ "Report type": "Launch" })],
      Websites: [siteRow({ Status: "launch" })],
    });
    const { client } = idempotencyConflictClient();
    const res = await sendApprovedReports({ ...h.io, resend: client });

    expect(res.code).toBe(0);
    expect(res.output).toContain("flipped to maintained");

    // The Launch flip runs after the (conflict-resolved) success, so a launch that
    // sent-but-never-flipped on the prior run reconciles here.
    expect(h.siteWrites).toHaveLength(1);
    expect(h.siteWrites[0]!.fields["Status"]).toBe("maintained");
  });

  it("still sends when the launch flip errors, but REDS the run (M6b, inverted at the freeze)", async () => {
    const h = harness({
      Reports: [reportRow({ "Report type": "Launch" })],
      Websites: [siteRow({ Status: "launch" })],
    });
    // Only the site write (the Status flip) throws. The send + sent stamp must
    // still succeed — the email already went out and the row must not replay. But
    // the flip failure can no longer be a green-run warning (#643): nothing
    // converges it, and Turso — the store lead routing reads — would keep the
    // site in launch-period forever.
    const { client } = captureClient();
    const res = await sendApprovedReports({
      ...h.io,
      resend: client,
      siteMirror: {
        ...h.io.siteMirror,
        site: async () => {
          throw new Error("Status field write blew up");
        },
      },
    });
    expect(res.code).toBe(1);
    expect(res.output).toContain("✓ sent:");
    expect(res.output).toContain("launch flip failed");
    expect(h.stamps).toHaveLength(1);
    expect(res.output).toContain("Status field write blew up");
  });

  it("reds the run when the sent-stamp mirror fails — but still runs the Launch flip", async () => {
    // The stamp mirror and the launch flip are independent recoveries: one
    // failing must not rob the other of its attempt, and neither may hide in a
    // green run.
    const h = harness({
      Reports: [reportRow({ "Report type": "Launch" })],
      Websites: [siteRow({ Status: "launch" })],
    });
    const { client } = captureClient();
    const res = await sendApprovedReports({
      ...h.io,
      resend: client,
      reportSentMirror: async () => {
        throw new Error("SQLITE_BUSY");
      },
    });
    expect(res.code).toBe(1);
    expect(res.output).toContain("✓ sent:");
    expect(res.output).toContain("sent-stamp mirror failed");
    expect(res.output).toContain("SQLITE_BUSY");
    expect(res.output).toContain("launched:");
    expect(h.siteWrites.map((w) => w.id)).toEqual(["rec_site_acme"]);
  });
});

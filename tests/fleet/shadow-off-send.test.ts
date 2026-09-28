import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  touched: [] as string[],
  events: [] as string[],
}));

vi.mock("../../src/reports/airtable/client.js", async (importOriginal) => {
  const { untouchableBase } = await import("./_helpers/untouchable-airtable.js");
  return {
    ...(await importOriginal<typeof import("../../src/reports/airtable/client.js")>()),
    openBase: () => untouchableBase(h.touched),
  };
});

vi.mock("../../src/reports/maintenance-email/header-image.js", () => ({
  prepareHeaderImage: vi.fn(async () => ({
    bytes: new Uint8Array([255, 216, 255]),
    contentType: "image/jpeg",
    displayWidth: 600,
    displayHeight: 800,
    placeholderColor: "#cccccc",
  })),
}));

vi.mock("../../src/audits/fleet-events-writer.js", () => ({
  recordFleetEventsBestEffort: vi.fn(async (events: Array<{ type: string }>) => {
    h.events.push(...events.map((e) => e.type));
  }),
}));

import { sendApprovedReports } from "../../src/reports/send/orchestrate.js";
import type { ResendClient, ResendSendInput } from "../../src/reports/send/resend.js";
import { mapRow as mapReport } from "../../src/reports/airtable/reports.js";
import { mapRow as mapSite } from "../../src/reports/airtable/websites.js";
import { untouchableFetch } from "./_helpers/untouchable-airtable.js";

const SITE = mapSite({
  id: "rec_site_acme",
  fields: {
    Name: "Acme Co",
    Status: "launch",
    url: "https://acme.example.com",
    "Report recipients (To)": "owner@acme.example.com",
  },
});

const LAUNCH = mapReport({
  id: "rec_report_1",
  fields: {
    "Report ID": "Acme Co — Launch — 2026-09-28",
    Site: ["rec_site_acme"],
    "Report type": "Launch",
    "Completed on": "2026-09-28",
    "Lighthouse — Performance": 90,
    "Lighthouse — Accessibility": 100,
    "Lighthouse — Best Practices": 100,
    "Lighthouse — SEO": 100,
    "Draft ready": true,
    "Approved to send": true,
  },
});

let logged: () => string;

beforeEach(() => {
  h.touched.length = 0;
  h.events.length = 0;
  vi.stubGlobal("fetch", untouchableFetch(h.touched));
  vi.stubEnv("TURSO_DATABASE_URL", "");
  vi.stubEnv("TURSO_AUTH_TOKEN", "");
  vi.stubEnv("AIRTABLE_PAT", "pat_test");
  vi.stubEnv("AIRTABLE_BASE_ID", "app_test");
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  logged = () => log.mock.calls.flat().join("\n");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("shipped shadow-off: report --send-ready never touches Airtable", () => {
  it("sends a Launch from its Turso plate, stamps and flips it in Turso, and the run is green", async () => {
    const sent: ResendSendInput[] = [];
    const resend: ResendClient = {
      send: async (input) => {
        sent.push(input);
        return { messageId: "msg_1" };
      },
    };
    const stamps: Array<{ id: string; sentAt: Date; messageId: string | null }> = [];
    const sites: Array<{ id: string; fields: Record<string, unknown> }> = [];

    const res = await sendApprovedReports({
      resend,
      sendable: async () => [LAUNCH],
      roster: async () => [SITE],
      loadHeaderPlate: async () => new Uint8Array([1, 2, 3]),
      reportSentMirror: async (id, sentAt, messageId) => {
        stamps.push({ id, sentAt, messageId });
      },
      siteMirror: {
        created: async () => {},
        hasRow: async () => true,
        health: async () => {},
        site: async (id, fields) => {
          sites.push({ id, fields });
        },
      },
    });

    expect(h.touched).toEqual([]);
    expect(res.code).toBe(0);
    expect(res.output).toContain("✓ sent: Acme Co — Launch — 2026-09-28 (msg_1)");
    expect(res.output).toContain("↳ launched: Acme Co flipped to maintained");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toEqual(["owner@acme.example.com"]);
    expect(sent[0]!.idempotencyKey).toBe("report:rec_report_1");
    expect(stamps).toEqual([{ id: "rec_report_1", sentAt: expect.any(Date), messageId: "msg_1" }]);
    expect(sites).toEqual([
      {
        id: "rec_site_acme",
        fields: {
          Status: "maintained",
          "Launched at": expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        },
      },
    ]);
    expect(h.events).toContain("site_launched");
    expect(logged()).toContain("header=turso");
    expect(logged()).toContain(
      "AIRTABLE_SHADOW skipped=shadow-off writer=updateLaunched id=rec_site_acme",
    );
    expect(logged()).toContain(
      "AIRTABLE_SHADOW skipped=shadow-off writer=stampSent id=rec_report_1",
    );
  });
});

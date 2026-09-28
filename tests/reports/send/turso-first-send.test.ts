import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { sendApprovedReports } from "../../../src/reports/send/orchestrate.js";
import type { ResendClient } from "../../../src/reports/send/resend.js";
import type { AirtableBase } from "../../../src/reports/airtable/client.js";
import { mapRow as mapReport } from "../../../src/reports/airtable/reports.js";
import { launchedFields, mapRow as mapSite } from "../../../src/reports/airtable/websites.js";

vi.mock("../../../src/reports/maintenance-email/header-image.js", () => ({
  prepareHeaderImage: vi.fn(async () => ({
    bytes: new Uint8Array([255, 216, 255]),
    contentType: "image/jpeg",
    displayWidth: 600,
    displayHeight: 800,
    placeholderColor: "#cccccc",
  })),
}));

vi.mock("../../../src/reports/airtable/client.js", async () => {
  const actual = await vi.importActual<typeof import("../../../src/reports/airtable/client.js")>(
    "../../../src/reports/airtable/client.js",
  );
  return { ...actual, openBase: vi.fn() };
});

vi.mock("../../../src/db/freeze.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/db/freeze.js")>()),
  AIRTABLE_SHADOW_WRITES: true,
}));

vi.mock("../../../src/audits/fleet-events-writer.js", () => ({
  recordFleetEventsBestEffort: vi.fn(async () => {}),
}));

import { openBase } from "../../../src/reports/airtable/client.js";

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

type Attempt = { table: string; id: string; fields: Record<string, unknown> };

function quotaError(): Error {
  return Object.assign(new Error("Airtable monthly API call quota exhausted"), {
    code: "AIRTABLE_QUOTA_EXHAUSTED",
  });
}

function orderedBase(log: string[], attempts: Attempt[], fail: boolean): AirtableBase {
  return ((table: string) => ({
    update: async (records: Array<{ id: string; fields: Record<string, unknown> }>) => {
      log.push(`airtable:${table}:${records[0]!.id}`);
      attempts.push({ table, id: records[0]!.id, fields: records[0]!.fields });
      if (fail) throw quotaError();
      return records;
    },
  })) as unknown as AirtableBase;
}

function sentClient(): ResendClient {
  return { send: async () => ({ messageId: "msg_1" }) };
}

function conflictClient(): ResendClient {
  return {
    send: async () => {
      throw new Error(
        "Resend error: This idempotency key has been used with this HTTP method and endpoint " +
          "but the request body has changed.",
      );
    },
  };
}

function tursoWriters(log: string[], opts: { stampFails?: boolean } = {}) {
  const stamps: Array<{ id: string; sentAt: Date; messageId: string | null }> = [];
  const sites: Array<{ id: string; fields: Record<string, unknown> }> = [];
  return {
    stamps,
    sites,
    reportSentMirror: async (id: string, sentAt: Date, messageId: string | null) => {
      log.push(`turso:sent:${id}`);
      if (opts.stampFails) throw new Error("SQLITE_BUSY");
      stamps.push({ id, sentAt, messageId });
    },
    siteMirror: {
      created: async () => {},
      hasRow: async () => true,
      health: async () => {},
      site: async (id: string, fields: Record<string, unknown>) => {
        log.push(`turso:site:${id}`);
        sites.push({ id, fields });
      },
    },
  };
}

const io = {
  sendable: async () => [LAUNCH],
  roster: async () => [SITE],
  loadHeaderPlate: async () => new Uint8Array([1, 2, 3]),
};

beforeEach(() => {
  vi.stubEnv("AIRTABLE_PAT", "pat_test");
  vi.stubEnv("AIRTABLE_BASE_ID", "app_test");
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("report --send-ready writes Turso before the Airtable shadow", () => {
  it("stamps and flips a Launch in Turso before either Airtable write, with the same payloads", async () => {
    const log: string[] = [];
    const attempts: Attempt[] = [];
    vi.mocked(openBase).mockReturnValue(orderedBase(log, attempts, false));
    const turso = tursoWriters(log);

    const res = await sendApprovedReports({ ...io, ...turso, resend: sentClient() });

    expect(res.code).toBe(0);
    expect(log).toEqual([
      "turso:sent:rec_report_1",
      "turso:site:rec_site_acme",
      "airtable:Websites:rec_site_acme",
      "airtable:Reports:rec_report_1",
    ]);
    const [stamp] = turso.stamps;
    expect(stamp).toEqual({ id: "rec_report_1", sentAt: expect.any(Date), messageId: "msg_1" });
    expect(attempts[1]!.fields).toEqual({
      "Sent at": stamp!.sentAt.toISOString(),
      "Resend message ID": "msg_1",
    });
    expect(turso.sites[0]!.fields).toEqual(attempts[0]!.fields);
    expect(turso.sites[0]!.fields).toEqual(
      launchedFields(attempts[0]!.fields["Launched at"] as string),
    );
  });

  it("the 409 recovery stamps Turso first too, with a null message id in both stores", async () => {
    const log: string[] = [];
    const attempts: Attempt[] = [];
    vi.mocked(openBase).mockReturnValue(orderedBase(log, attempts, false));
    const turso = tursoWriters(log);

    const res = await sendApprovedReports({ ...io, ...turso, resend: conflictClient() });

    expect(res.code).toBe(0);
    expect(res.output).toContain("idempotent-conflict");
    expect(log).toEqual([
      "turso:sent:rec_report_1",
      "turso:site:rec_site_acme",
      "airtable:Websites:rec_site_acme",
      "airtable:Reports:rec_report_1",
    ]);
    expect(turso.stamps[0]!.messageId).toBeNull();
    expect(attempts[1]!.fields).toEqual({ "Sent at": turso.stamps[0]!.sentAt.toISOString() });
  });

  it("an exhausted Airtable costs neither Turso write, and both shadow failures still red the run", async () => {
    const log: string[] = [];
    const attempts: Attempt[] = [];
    vi.mocked(openBase).mockReturnValue(orderedBase(log, attempts, true));
    const turso = tursoWriters(log);

    const res = await sendApprovedReports({ ...io, ...turso, resend: sentClient() });

    expect(turso.stamps).toEqual([
      { id: "rec_report_1", sentAt: expect.any(Date), messageId: "msg_1" },
    ]);
    expect(turso.sites).toEqual([
      { id: "rec_site_acme", fields: { Status: "maintained", "Launched at": expect.any(String) } },
    ]);
    expect(res.code).toBe(1);
    expect(res.output).toContain(
      "⚠ launch flip failed for Acme Co: Airtable monthly API call quota exhausted",
    );
    expect(res.output).toContain(
      "✗ Acme Co — Launch — 2026-09-28 — Airtable monthly API call quota exhausted",
    );
    expect(res.output).not.toContain("launched:");
  });

  it("a failed Turso stamp still reds the run and still reaches the Airtable stamp", async () => {
    const log: string[] = [];
    const attempts: Attempt[] = [];
    vi.mocked(openBase).mockReturnValue(orderedBase(log, attempts, false));
    const turso = tursoWriters(log, { stampFails: true });

    const res = await sendApprovedReports({ ...io, ...turso, resend: sentClient() });

    expect(res.code).toBe(1);
    expect(res.output).toContain("sent-stamp mirror failed for Acme Co — Launch — 2026-09-28");
    expect(log).toEqual([
      "turso:sent:rec_report_1",
      "turso:site:rec_site_acme",
      "airtable:Websites:rec_site_acme",
      "airtable:Reports:rec_report_1",
    ]);
  });
});

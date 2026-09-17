/**
 * #646 step 4: the nightly send reads its QUEUE, its ROSTER and its HEADER PLATE
 * from Turso.
 *
 * The rest of the send suite injects those three from the fake Airtable base its
 * fixtures live in (and takes the Airtable-attachment fallback for the plate),
 * because what it pins is the send's own behaviour. This file wires what the CLI
 * wires — `listSendableReports`, `listSites` and `loadHeaderImage` over a REAL
 * migrated libSQL database in a temp `file:` (never `:memory:`, never a `TURSO_*`
 * url from the environment) — and pins the two facts that matter:
 *
 *  1. a report is selected, addressed and rendered with Airtable holding NOTHING;
 *  2. the Airtable calls that remain are the shadow WRITES (the sent stamp).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, type Db } from "../../../src/db/client.js";
import { listSendableReports, listSites, mirrorSiteInsert } from "../../../src/db/fleet-state.js";
import { storeHeaderImage, loadHeaderImage } from "../../../src/db/header-images.js";
import { sendApprovedReports } from "../../../src/reports/send/orchestrate.js";
import type { ResendClient, ResendSendInput } from "../../../src/reports/send/resend.js";
import { makeFakeBase, type FakeAirtableBase } from "../_helpers/fake-airtable-base.js";

// The real header pipeline needs sharp and a real JPEG; the plate's PROVENANCE is
// what this file is about, so the processing step is stubbed exactly as the rest
// of the send suite stubs it.
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

vi.mock("../../../src/audits/fleet-events-writer.js", () => ({
  recordFleetEventsBestEffort: vi.fn(async () => {}),
}));

import { openBase } from "../../../src/reports/airtable/client.js";

const SITE = "recTURSOSITE";
const REPORT = "recTURSOREPORT";
const PLATE = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

let dir: string;
let db: Db;
let base: FakeAirtableBase;

function captureClient(): { client: ResendClient; captured: ResendSendInput[] } {
  const captured: ResendSendInput[] = [];
  return {
    captured,
    client: {
      async send(input) {
        captured.push(input);
        return { messageId: "msg_turso_1" };
      },
    },
  };
}

beforeEach(async () => {
  vi.stubEnv("AIRTABLE_PAT", "pat_test");
  vi.stubEnv("AIRTABLE_BASE_ID", "app_test");
  // Any fetch at all would mean the Airtable attachment fallback ran.
  global.fetch = vi.fn(async () => {
    throw new Error("the send fetched an attachment — the Turso plate was not used");
  }) as unknown as typeof global.fetch;
  dir = mkdtempSync(join(tmpdir(), "send-turso-"));
  db = await openDb({ url: `file:${join(dir, "fleet.db")}` });
  await mirrorSiteInsert(
    db,
    {
      id: SITE,
      fields: {
        Name: "Turso Co",
        Status: "maintained",
        url: "https://turso.example.com",
        "Report recipients (To)": "owner@turso.example.com",
        pScore: 92,
        rScore: 100,
        bpScore: 96,
        seoScore: 94,
      },
    },
    "2026-09-17T00:00:00.000Z",
  );
  await storeHeaderImage(db, SITE, {
    bytes: PLATE,
    filename: "turso.jpg",
    contentType: "image/jpeg",
    generatedAt: "2026-09-17T00:00:00.000Z",
  });
  await db
    .insertInto("reports")
    .values({
      id: REPORT,
      report_id: "Turso Co — Maintenance — 2026-09-17",
      site_id: SITE,
      report_type: "Maintenance",
      period: "2026-09",
      period_start: "2026-08-17",
      period_end: "2026-09-17",
      completed_on: "2026-09-17",
      lighthouse_performance: 92,
      lighthouse_accessibility: 100,
      lighthouse_best_practices: 96,
      lighthouse_seo: 94,
      draft_ready: 1,
      approved_to_send: 1,
      send_override: 0,
      sent_at: null,
      // Every gating field pass — the health gate is not what this file is about.
      checklist_auto_evidence: JSON.stringify(
        Object.fromEntries(
          [
            "Maint: Deploy & Function Health",
            "Maint: CMS Checked",
            "Maint: Domain, DNS & SSL",
            "Maint: Google Indexed",
            "Maint: Security Updates",
            "Maint: Uptime Checked",
          ].map((f) => [f, { result: "pass", checkedAt: "2026-09-17T00:00:00.000Z", note: "" }]),
        ),
      ),
    })
    .execute();
  base = makeFakeBase({ Reports: [], Websites: [] });
  vi.mocked(openBase).mockReturnValue(base);
});

afterEach(async () => {
  await db.destroy();
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const io = () => ({
  sendable: () => listSendableReports(db),
  roster: () => listSites(db),
  loadHeaderPlate: async (siteId: string) => (await loadHeaderImage(db, siteId))?.bytes ?? null,
});

describe("the send path, read from Turso", () => {
  it("sends a queued report with an EMPTY Airtable base — queue, roster and header plate all from Turso", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { client, captured } = captureClient();
    const res = await sendApprovedReports({ ...io(), resend: client });

    expect(res.code).toBe(0);
    expect(res.output).toContain("✓ sent:");
    expect(captured).toHaveLength(1);
    expect(captured[0]!.to).toEqual(["owner@turso.example.com"]);
    // The plate came from the database, and no attachment was fetched (the stubbed
    // fetch above throws if one is).
    expect(log.mock.calls.flat().join("\n")).toContain(
      `REPORT_SEND report=Turso Co — Maintenance — 2026-09-17 site=Turso Co header=turso`,
    );
    // Airtable saw exactly one thing: the sent stamp — a WRITE, not a read.
    expect(base.__calls.filter((c) => c.kind === "select")).toEqual([]);
    const updates = base.__calls.filter((c) => c.kind === "update");
    expect(updates).toHaveLength(1);
    expect(updates[0]!.records[0]!.id).toBe(REPORT);
    expect(updates[0]!.records[0]!.fields["Sent at"]).toBeDefined();
  });

  it("a report that is not approved is not in the queue at all", async () => {
    await db.updateTable("reports").set({ approved_to_send: 0 }).where("id", "=", REPORT).execute();
    const { client, captured } = captureClient();
    const res = await sendApprovedReports({ ...io(), resend: client });
    expect(res).toEqual({ output: "No reports ready to send.", code: 0 });
    expect(captured).toHaveLength(0);
  });

  it("falls back to the Airtable attachment when Turso holds no plate — and says which source it used", async () => {
    await db
      .updateTable("sites")
      .set({ header_image: null, header_image_filename: null, header_image_type: null })
      .where("id", "=", SITE)
      .execute();
    // The one-site Airtable lookup the fallback makes, seeded with this site's row.
    base = makeFakeBase({
      Reports: [],
      Websites: [
        {
          id: SITE,
          fields: {
            Name: "Turso Co",
            "Header image": [
              { url: "https://example.com/header.jpg", filename: "t.jpg", type: "image/jpeg" },
            ],
          },
        },
      ],
    });
    vi.mocked(openBase).mockReturnValue(base);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => "image/jpeg" },
      arrayBuffer: async () => new ArrayBuffer(8),
    }) as unknown as typeof global.fetch;
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { client, captured } = captureClient();

    const res = await sendApprovedReports({ ...io(), resend: client });

    expect(res.code).toBe(0);
    expect(captured).toHaveLength(1);
    expect(log.mock.calls.flat().join("\n")).toContain("header=airtable");
  });

  it("no plate in Turso and no Airtable record: the report fails, naming the command that fixes it", async () => {
    await db
      .updateTable("sites")
      .set({ header_image: null, header_image_filename: null, header_image_type: null })
      .where("id", "=", SITE)
      .execute();
    const { client, captured } = captureClient();
    const res = await sendApprovedReports({ ...io(), resend: client });
    expect(res.code).toBe(1);
    expect(res.output).toContain("no Header image");
    expect(res.output).toContain("header-image turso-co --write-back");
    expect(captured).toHaveLength(0);
  });
});

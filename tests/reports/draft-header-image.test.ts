import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../src/db/client.js";
import { mirrorSiteInsert } from "../../src/db/fleet-state.js";
import { loadHeaderImage } from "../../src/db/header-images.js";
import { refreshHeaderImage, draftReportForSite } from "../../src/reports/draft.js";
import type { WebsiteRow } from "../../src/fleet/site-row.js";
import { makeFakeReportWriter } from "./_helpers/fake-report-writer.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";
import { mapRow } from "../../src/reports/report-fields.js";

// Stand in for the real capture so the wiring tests below never launch a browser.
// The tests in the first describe don't touch this — they inject their own deps.
vi.mock("../../src/reports/header-image/index.js", () => ({
  generateHeaderImage: vi.fn(async () => ({
    bytes: new Uint8Array([1]),
    domain: "acme.example.com",
    filename: "acmeHeader.jpg",
    contentType: "image/jpeg" as const,
  })),
}));
import { generateHeaderImage } from "../../src/reports/header-image/index.js";

const site = { id: "rec1", name: "Acme", url: "https://acme.com/" } as WebsiteRow;

describe("reports/draft refreshHeaderImage", () => {
  const generated = () => ({
    bytes: new Uint8Array([1]),
    domain: "acme.com",
    filename: "acmeHeader.jpg",
    contentType: "image/jpeg" as const,
  });

  it("stores the freshly generated header as the site's Turso plate", async () => {
    const store = vi.fn(async () => {});
    const generate = vi.fn(async () => generated());
    const ok = await refreshHeaderImage(site, { generate, store });
    expect(ok).toBe(true);
    expect(store).toHaveBeenCalledWith("rec1", {
      bytes: new Uint8Array([1]),
      filename: "acmeHeader.jpg",
      contentType: "image/jpeg",
      generatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
  });

  it("returns false and does NOT throw when capture fails — the draft continues", async () => {
    const store = vi.fn(async () => {});
    const generate = vi.fn(async () => {
      throw new Error("net::ERR_TIMED_OUT");
    });
    await expect(refreshHeaderImage(site, { generate, store })).resolves.toBe(false);
    expect(store).not.toHaveBeenCalled();
  });

  it("returns false when the store fails, leaving the stored plate intact", async () => {
    const generate = vi.fn(async () => generated());
    const store = vi.fn(async () => {
      throw new Error("turso down");
    });
    await expect(refreshHeaderImage(site, { generate, store })).resolves.toBe(false);
  });

  it("skips a site with no URL", async () => {
    const generate = vi.fn();
    const store = vi.fn();
    const ok = await refreshHeaderImage({ ...site, url: "" } as WebsiteRow, { generate, store });
    expect(ok).toBe(false);
    expect(generate).not.toHaveBeenCalled();
  });
});

describe("the default store is the plate the send reads", () => {
  let dir: string;

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes Turso's sites.header_image, which loadHeaderImage hands the send", async () => {
    dir = mkdtempSync(join(tmpdir(), "header-refresh-"));
    const url = `file:${join(dir, "fleet.db")}`;
    const db = await openDb({ url });
    await mirrorSiteInsert(
      db,
      { id: "rec1", fields: { Name: "Acme", Status: "maintained", url: "https://acme.com/" } },
      "2026-09-28T00:00:00.000Z",
    );
    vi.stubEnv("TURSO_DATABASE_URL", url);
    const generate = vi.fn(async () => ({
      bytes: new Uint8Array([7, 7, 7]),
      domain: "acme.com",
      filename: "acmeHeader.jpg",
      contentType: "image/jpeg" as const,
    }));
    await expect(refreshHeaderImage(site, { generate })).resolves.toBe(true);
    const stored = await loadHeaderImage(db, "rec1");
    expect(stored?.bytes).toEqual(new Uint8Array([7, 7, 7]));
    expect(stored?.filename).toBe("acmeHeader.jpg");
    await db.destroy();
  });

  it("without Turso configured, warns and returns false instead of throwing", async () => {
    dir = mkdtempSync(join(tmpdir(), "header-refresh-"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const generate = vi.fn(async () => generated());
    await expect(refreshHeaderImage(site, { generate })).resolves.toBe(false);
    expect(warn.mock.calls.flat().join("\n")).toMatch(/header-image refresh skipped for Acme/);
    warn.mockRestore();
  });

  const generated = () => ({
    bytes: new Uint8Array([1]),
    domain: "acme.com",
    filename: "acmeHeader.jpg",
    contentType: "image/jpeg" as const,
  });
});

/**
 * The draft-time wiring, kept honest in both directions. `DraftOptions.refreshHeader`
 * exists so unit suites don't pay a real chromium launch
 * per case — but an opt-out that accidentally reads `undefined` as "off" would silently
 * disable the feature on the nightly path, where nothing would notice. So: unset MUST
 * refresh, `false` MUST NOT.
 */
describe("draftReportForSite header-refresh wiring", () => {
  beforeEach(() => {
    delete process.env.GA_SUBJECT;
    vi.mocked(generateHeaderImage).mockClear();
  });

  const scoredSite = (): WebsiteRow =>
    makeWebsiteRow({ pScore: 87, rScore: 91, bpScore: 100, seoScore: 95 });

  it("refreshes when refreshHeader is unset — the production default", async () => {
    await draftReportForSite(scoredSite(), "Maintenance", {
      reportMirror: makeFakeReportWriter(),
    });
    expect(generateHeaderImage).toHaveBeenCalledTimes(1);
    expect(generateHeaderImage).toHaveBeenCalledWith({
      url: "https://acme.example.com",
      slug: "acme-co",
    });
  });

  it("skips the refresh when refreshHeader is false", async () => {
    await draftReportForSite(scoredSite(), "Maintenance", {
      refreshHeader: false,
      reportMirror: makeFakeReportWriter(),
    });
    expect(generateHeaderImage).not.toHaveBeenCalled();
  });

  it("never refreshes on the no-IO render path, even with refreshHeader unset", async () => {
    const result = await draftReportForSite(scoredSite(), "Maintenance", {
      previewOnly: true,
      previewPath: `${process.env.TMPDIR ?? "/tmp"}/draft-header-wiring-preview.html`,
    });
    expect(result.reportRow).toBeNull();
    expect(generateHeaderImage).not.toHaveBeenCalled();
  });

  // P1-117: an approved report can wait up to a week for its due date, and the
  // send reads the site's plate when it goes. No draft for the site replaces the
  // plate in between.
  it("keeps the plate while an approved report for the site is unsent", async () => {
    const site = scoredSite();
    const approved = mapRow({
      id: "rec_approved",
      fields: {
        Site: [site.id],
        "Report ID": "Acme Co — Testing — 2026-11-14",
        "Report type": "Testing",
        "Draft ready": true,
        "Approved to send": true,
        "Due on": "2026-11-21",
      },
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await draftReportForSite(site, "Maintenance", {
      reportMirror: makeFakeReportWriter([approved]),
    });
    expect(generateHeaderImage).not.toHaveBeenCalled();
    expect(log.mock.calls.flat().join("\n")).toContain(
      "header image kept for Acme Co: Acme Co — Testing — 2026-11-14 is approved and not yet sent",
    );
    log.mockRestore();
  });

  it("refreshes for a sent, pending, withdrawn or unqueued report: none of them waits to send", async () => {
    const site = scoredSite();
    const row = (id: string, fields: Record<string, unknown>) =>
      mapRow({ id, fields: { Site: [site.id], "Report type": "Testing", ...fields } });
    await draftReportForSite(site, "Maintenance", {
      reportMirror: makeFakeReportWriter([
        row("rec_sent", {
          "Draft ready": true,
          "Approved to send": true,
          "Sent at": "2026-11-21T16:07:00.000Z",
        }),
        row("rec_pending", { "Draft ready": true }),
        row("rec_withdrawn", {
          "Draft ready": true,
          "Approved to send": true,
          "Withdrawn at": "2026-11-20T00:00:00Z",
        }),
        // Approved but not queued: no run will send it, so it holds nothing.
        row("rec_unqueued", { "Approved to send": true }),
      ]),
    });
    expect(generateHeaderImage).toHaveBeenCalledTimes(1);
  });
});

/** P1-117: the body stored at draft time is the preview the operator approves, so
 *  it carries the same date the send renders: the due date. */
describe("draftReportForSite email date (P1-117)", () => {
  it("dates the stored body by the due date the nightly drafted it for", async () => {
    const writer = makeFakeReportWriter();
    await draftReportForSite(
      makeWebsiteRow({ pScore: 87, rScore: 91, bpScore: 100, seoScore: 95 }),
      "Maintenance",
      { reportMirror: writer, refreshHeader: false, dueOn: new Date("2099-03-07T00:00:00Z") },
    );
    expect(writer.bodies[0]!.html).toContain("03.07.2099");
    expect(writer.inserts[0]!.fields["Due on"]).toBe("2099-03-07");
  });
});

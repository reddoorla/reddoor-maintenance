import { describe, it, expect, vi, beforeEach } from "vitest";
import { refreshHeaderImage, draftReportForSite } from "../../src/reports/draft.js";
import type { WebsiteRow } from "../../src/reports/airtable/websites.js";
import { makeFakeBase } from "./_helpers/fake-airtable-base.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

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
  it("uploads a freshly generated header", async () => {
    const upload = vi.fn(async () => {});
    const generate = vi.fn(async () => ({
      bytes: new Uint8Array([1]),
      domain: "acme.com",
      filename: "acmeHeader.jpg",
      contentType: "image/jpeg" as const,
    }));
    const ok = await refreshHeaderImage(site, { generate, upload });
    expect(ok).toBe(true);
    expect(upload).toHaveBeenCalledWith(
      "rec1",
      "Header image",
      new Uint8Array([1]),
      "acmeHeader.jpg",
      "image/jpeg",
      // replace: Airtable's upload endpoint appends and readers take
      // attachment [0], so without this the field accumulates and the site
      // keeps sending its OLDEST header.
      { replaceIn: "Websites" },
    );
  });

  it("returns false and does NOT throw when capture fails — the draft continues", async () => {
    const upload = vi.fn(async () => {});
    const generate = vi.fn(async () => {
      throw new Error("net::ERR_TIMED_OUT");
    });
    await expect(refreshHeaderImage(site, { generate, upload })).resolves.toBe(false);
    expect(upload).not.toHaveBeenCalled();
  });

  it("returns false when the upload fails, leaving the stored header intact", async () => {
    const generate = vi.fn(async () => ({
      bytes: new Uint8Array([1]),
      domain: "acme.com",
      filename: "acmeHeader.jpg",
      contentType: "image/jpeg" as const,
    }));
    const upload = vi.fn(async () => {
      throw new Error("airtable 503");
    });
    await expect(refreshHeaderImage(site, { generate, upload })).resolves.toBe(false);
  });

  it("skips a site with no URL", async () => {
    const generate = vi.fn();
    const upload = vi.fn();
    const ok = await refreshHeaderImage({ ...site, url: "" } as WebsiteRow, { generate, upload });
    expect(ok).toBe(false);
    expect(generate).not.toHaveBeenCalled();
  });
});

/**
 * The draft-time wiring, kept honest in both directions. `DraftOptions.refreshHeader`
 * exists so unit suites (which all pass a fake base) don't pay a real chromium launch
 * per case — but an opt-out that accidentally reads `undefined` as "off" would silently
 * disable the feature on the nightly path, where nothing would notice. So: unset MUST
 * refresh, `false` MUST NOT.
 */
describe("draftReportForSite header-refresh wiring", () => {
  beforeEach(() => {
    // uploadAttachment posts to content.airtable.com via fetch; stub it out.
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => "",
    }) as unknown as typeof global.fetch;
    process.env.AIRTABLE_PAT = "pat_test";
    process.env.AIRTABLE_BASE_ID = "app_test";
    delete process.env.GA_SUBJECT;
    vi.mocked(generateHeaderImage).mockClear();
  });

  const scoredSite = (): WebsiteRow =>
    makeWebsiteRow({ pScore: 87, rScore: 91, bpScore: 100, seoScore: 95 });

  it("refreshes when refreshHeader is unset — the production default", async () => {
    const base = makeFakeBase({ Reports: [] });
    await draftReportForSite(base, scoredSite(), "Maintenance");
    expect(generateHeaderImage).toHaveBeenCalledTimes(1);
    expect(generateHeaderImage).toHaveBeenCalledWith({
      url: "https://acme.example.com",
      slug: "acme-co",
    });
  });

  it("skips the refresh when refreshHeader is false", async () => {
    const base = makeFakeBase({ Reports: [] });
    await draftReportForSite(base, scoredSite(), "Maintenance", { refreshHeader: false });
    expect(generateHeaderImage).not.toHaveBeenCalled();
  });

  it("never refreshes on the no-IO render path, even with refreshHeader unset", async () => {
    const result = await draftReportForSite(null, scoredSite(), "Maintenance", {
      previewOnly: true,
      previewPath: `${process.env.TMPDIR ?? "/tmp"}/draft-header-wiring-preview.html`,
    });
    expect(result.reportRow).toBeNull();
    expect(generateHeaderImage).not.toHaveBeenCalled();
  });
});

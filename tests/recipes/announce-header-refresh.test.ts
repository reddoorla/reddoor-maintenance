import { describe, it, expect, beforeEach, vi } from "vitest";
import { announce } from "../../src/recipes/announce.js";
import { makeFakeBase } from "../reports/_helpers/fake-airtable-base.js";

// No network: GA/Search enrichment stubbed to "not configured".
vi.mock("../../src/reports/draft.js", async (orig) => ({
  ...(await orig<typeof import("../../src/reports/draft.js")>()),
  fetchGaUsers: vi.fn(),
  fetchSearch: vi.fn(),
}));
// Stand in for the real capture so these tests never launch a browser.
vi.mock("../../src/reports/header-image/index.js", () => ({
  generateHeaderImage: vi.fn(async () => ({
    bytes: new Uint8Array([1]),
    domain: "acme.example.com",
    filename: "acmeHeader.jpg",
    contentType: "image/jpeg" as const,
  })),
}));
import { fetchGaUsers, fetchSearch } from "../../src/reports/draft.js";
import { generateHeaderImage } from "../../src/reports/header-image/index.js";

const NOW = new Date("2026-06-17T12:00:00.000Z");

beforeEach(() => {
  // uploadAttachment POSTs to content.airtable.com via global fetch.
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => "",
    json: async () => ({ fields: {} }),
  }) as unknown as typeof global.fetch;
  process.env.AIRTABLE_PAT = "pat_test";
  process.env.AIRTABLE_BASE_ID = "app_test";
  delete process.env.GA_SUBJECT;
  vi.mocked(fetchGaUsers).mockResolvedValue({ value: null, softFailed: false });
  vi.mocked(fetchSearch).mockResolvedValue({
    value: null,
    softFailed: false,
    defaultQueryMissed: false,
    propertyMissing: false,
    notConfigured: false,
  });
  vi.mocked(generateHeaderImage).mockClear();
});

function baseWithOneSite() {
  return makeFakeBase({
    Websites: [
      {
        id: "rec1",
        fields: {
          Name: "Acme Co",
          url: "https://acme.example.com",
          Status: "maintained",
          pScore: 87,
          rScore: 91,
          bpScore: 100,
          seoScore: 95,
        },
      },
    ],
    Reports: [],
  });
}

/**
 * Announce never refreshed the header at all, so a site whose stored header predated a
 * plate change kept announcing with the old one until an unrelated Maintenance/Testing
 * draft happened to heal it — which is how eleven sites sat on a header reading "Your
 * website maintenance is complete." regardless of report type.
 *
 * `refreshHeader` exists so unit suites (which all pass a fake base) don't pay a real
 * chromium launch per case. But an opt-out that reads `undefined` as "off" would
 * silently disable the refresh on the operator path, where nothing would notice. So:
 * unset MUST refresh, `false` MUST NOT.
 */
describe("announce header-refresh wiring", () => {
  it("refreshes when refreshHeader is unset — the operator default", async () => {
    await announce({ base: baseWithOneSite(), now: NOW });
    expect(generateHeaderImage).toHaveBeenCalledTimes(1);
    expect(generateHeaderImage).toHaveBeenCalledWith({
      url: "https://acme.example.com",
      slug: "acme-co",
    });
  });

  it("skips the refresh when refreshHeader is false", async () => {
    await announce({ base: baseWithOneSite(), now: NOW, refreshHeader: false });
    expect(generateHeaderImage).not.toHaveBeenCalled();
  });

  it("still drafts when the capture fails — the refresh is best-effort", async () => {
    vi.mocked(generateHeaderImage).mockRejectedValueOnce(new Error("net::ERR_TIMED_OUT"));
    const res = await announce({ base: baseWithOneSite(), now: NOW });
    expect(res.results[0]?.status).toBe("drafted");
  });
});

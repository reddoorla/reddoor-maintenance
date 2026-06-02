import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchSearchPresence } from "../../../src/reports/search/client.js";

function mockFetch(items: Array<{ link: string }>, ok = true, status = 200) {
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    status,
    text: async () => "error body",
    json: async () => ({ items }),
  }) as unknown as typeof global.fetch;
}

const cfg = { apiKey: "KEY", engineId: "CX" };

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("fetchSearchPresence", () => {
  it("reports the 1-based position of the site's domain in the results", async () => {
    mockFetch([
      { link: "https://competitor.com/" },
      { link: "https://example.org/page" },
      { link: "https://erpfunds.com/about" },
    ]);
    const out = await fetchSearchPresence({ ...cfg, query: "ERP funds", siteUrl: "erpfunds.com" });
    expect(out).toEqual({ foundOnPage1: true, position: 3 });
  });

  it("matches across www / scheme / path variants", async () => {
    mockFetch([{ link: "https://www.erpfunds.com/contact?x=1" }]);
    const out = await fetchSearchPresence({
      ...cfg,
      query: "ERP funds",
      siteUrl: "https://erpfunds.com",
    });
    expect(out).toEqual({ foundOnPage1: true, position: 1 });
  });

  it("returns not-found when the domain is absent from the top results", async () => {
    mockFetch([{ link: "https://competitor.com/" }, { link: "https://other.com/" }]);
    const out = await fetchSearchPresence({ ...cfg, query: "ERP funds", siteUrl: "erpfunds.com" });
    expect(out).toEqual({ foundOnPage1: false, position: null });
  });

  it("handles an empty result set", async () => {
    mockFetch([]);
    const out = await fetchSearchPresence({ ...cfg, query: "nonesuch", siteUrl: "erpfunds.com" });
    expect(out).toEqual({ foundOnPage1: false, position: null });
  });

  it("sends key, cx, the query, and num=10 to the Custom Search endpoint", async () => {
    mockFetch([{ link: "https://erpfunds.com" }]);
    await fetchSearchPresence({ ...cfg, query: "ERP funds & co", siteUrl: "erpfunds.com" });
    const url = String(vi.mocked(global.fetch).mock.calls[0]![0]);
    expect(url).toContain("https://www.googleapis.com/customsearch/v1");
    expect(url).toContain("key=KEY");
    expect(url).toContain("cx=CX");
    expect(url).toContain("num=10");
    expect(url).toContain("q=ERP+funds+%26+co"); // query encoded
  });

  it("throws on a non-OK response (quota / error) so the caller can soft-fail", async () => {
    mockFetch([], false, 429);
    await expect(
      fetchSearchPresence({ ...cfg, query: "x", siteUrl: "erpfunds.com" }),
    ).rejects.toThrow(/429/);
  });
});
